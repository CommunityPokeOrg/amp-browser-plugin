/**
 * Dependency-free HTML utilities: readable-text extraction, link extraction,
 * and title detection. Good enough for feeding pages to an LLM — not a
 * spec-compliant parser.
 */

const VOID_ELEMENTS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const BLOCK_ELEMENTS = new Set([
	'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl',
	'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header',
	'hgroup', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
])

/** Elements whose entire subtree is dropped before text extraction. */
const STRIP_ELEMENTS = new Set([
	'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object',
	'select', 'button', 'canvas', 'audio', 'video', 'nav', 'footer',
])

/** Entity map for the most common named entities. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
	copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
	times: '×', divide: '÷', deg: '°', plusmn: '±', middot: '·', bull: '•',
	dagger: '†', Dagger: '‡', sect: '§', para: '¶', euro: '€', pound: '£',
	yen: '¥', cent: '¢', curren: '¤', larr: '←', uarr: '↑', rarr: '→',
	darr: '↓', harr: '↔', minus: '−', lowast: '∗', radic: '√', infin: '∞',
}

/** Decode HTML entities (named, decimal, hex) in a string. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, entity: string) => {
		if (entity[0] === '#') {
			const code = entity[1]?.toLowerCase() === 'x'
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10)
			if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
				try {
					return String.fromCodePoint(code)
				} catch {
					return whole
				}
			}
			return whole
		}
		return NAMED_ENTITIES[entity] ?? whole
	})
}

/** Extract the document title, or null when absent. */
export function extractTitle(html: string): string | null {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
	if (!match) return null
	const title = decodeEntities(match[1] ?? '').replace(/\s+/g, ' ').trim()
	return title || null
}

interface Tag {
	name: string
	attrs: Record<string, string>
	selfClosing: boolean
	closing: boolean
}

function parseTag(raw: string): Tag | null {
	const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)\/?>$/.exec(raw)
	if (!match) return null
	const [, slash, name, attrSource] = match as unknown as [string, string, string, string]
	const attrs: Record<string, string> = {}
	const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'>]+))?/g
	for (const attrMatch of attrSource.matchAll(attrRe)) {
		const attrName = (attrMatch[1] ?? '').toLowerCase()
		const value = attrMatch[3] ?? attrMatch[4] ?? attrMatch[2] ?? ''
		// strip surrounding quotes for unquoted-value captures that kept them
		attrs[attrName] = decodeEntities(value.replace(/^["']|["']$/g, ''))
	}
	const selfClosing = /\/\s*>$/.test(raw) || VOID_ELEMENTS.has(name.toLowerCase())
	return { name: name.toLowerCase(), attrs, selfClosing, closing: slash === '/' }
}

function* tokens(html: string): Generator<{ kind: 'tag'; tag: Tag } | { kind: 'text'; text: string }> {
	// Split on comments, doctype, CDATA and tags; comments/CDATA are dropped.
	const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>?/gi
	let last = 0
	for (const match of html.matchAll(re)) {
		const index = match.index ?? 0
		if (index > last) {
			yield { kind: 'text', text: html.slice(last, index) }
		}
		const raw = match[0]
		if (raw.startsWith('<') && !raw.startsWith('<!') && !raw.startsWith('</!')) {
			const tag = parseTag(raw)
			if (tag) yield { kind: 'tag', tag }
		}
		last = index + raw.length
	}
	if (last < html.length) {
		yield { kind: 'text', text: html.slice(last) }
	}
}

/**
 * Convert HTML into a compact markdown-ish text representation:
 * headings become `#` lines, links become `[text](href)`, list items become
 * `- ` bullets, and navigation/boilerplate elements are dropped.
 */
export function htmlToMarkdown(html: string, baseUrl?: string): string {
	const out: string[] = []
	// Stack of element names currently being stripped; non-empty = inside
	// a removed subtree. Any nested open pushes, any close pops on match.
	const stripStack: string[] = []
	let depthPre = 0
	let pendingAnchor: { href: string | null; text: string[] } | null = null
	let headingLevel = 0
	let listDepth = 0

	const push = (s: string) => out.push(s)
	const newline = () => {
		if (out.length && !out[out.length - 1]!.endsWith('\n')) push('\n')
	}
	const blankLine = () => {
		newline()
		if (out.length && !out[out.length - 1]!.endsWith('\n\n')) push('\n')
	}
	const flushAnchor = () => {
		if (!pendingAnchor) return
		const label = pendingAnchor.text.join('').replace(/\s+/g, ' ').trim()
		const href = pendingAnchor.href
		pendingAnchor = null
		if (href && label) {
			const absolute = resolveHref(href, baseUrl)
			push(absolute && absolute !== label ? `[${label}](${absolute})` : label)
		} else {
			push(label)
		}
	}
	const emitText = (text: string) => {
		if (pendingAnchor) pendingAnchor.text.push(text)
		else push(text)
	}

	for (const token of tokens(html)) {
		if (token.kind === 'text') {
			if (stripStack.length > 0) continue
			let text = decodeEntities(token.text)
			if (depthPre === 0) {
				text = text.replace(/\s+/g, ' ')
			}
			if (!text) continue
			emitText(text)
			continue
		}

		const { tag } = token

		// Inside a stripped subtree: track nesting so the subtree end is found.
		if (stripStack.length > 0) {
			if (tag.closing) {
				// Pop through the matching open tag (forgiving on misnested HTML).
				const idx = stripStack.lastIndexOf(tag.name)
				if (idx !== -1) stripStack.length = idx
			} else if (!tag.selfClosing) {
				stripStack.push(tag.name)
			}
			continue
		}

		if (tag.closing) {
			if (tag.name === 'pre' && depthPre > 0) {
				depthPre = 0
				push('\n```\n')
			}
			if (/^h[1-6]$/.test(tag.name) && headingLevel > 0) {
				headingLevel = 0
				blankLine()
			}
			if (tag.name === 'a' && pendingAnchor) {
				flushAnchor()
			}
			if (tag.name === 'ul' || tag.name === 'ol') {
				listDepth = Math.max(0, listDepth - 1)
				blankLine()
			}
			if (BLOCK_ELEMENTS.has(tag.name)) blankLine()
			continue
		}

		if (STRIP_ELEMENTS.has(tag.name)) {
			if (!tag.selfClosing) stripStack.push(tag.name)
			continue
		}

		if (/^h[1-6]$/.test(tag.name)) {
			blankLine()
			headingLevel = Number(tag.name[1])
			push('#'.repeat(headingLevel) + ' ')
			continue
		}
		if (tag.name === 'pre') {
			blankLine()
			push('```\n')
			depthPre = 1
			continue
		}
		if (tag.name === 'br') {
			push('\n')
			continue
		}
		if (tag.name === 'li') {
			newline()
			push('  '.repeat(listDepth) + '- ')
			continue
		}
		if (tag.name === 'ul' || tag.name === 'ol') {
			blankLine()
			listDepth++
			continue
		}
		if (tag.name === 'img') {
			const alt = tag.attrs.alt?.trim()
			if (alt) push(alt)
			continue
		}
		if (tag.name === 'a') {
			if (!pendingAnchor) {
				pendingAnchor = { href: tag.attrs.href ?? null, text: [] }
			}
			continue
		}
		if (BLOCK_ELEMENTS.has(tag.name)) {
			blankLine()
		}
	}
	flushAnchor()

	// Collapse trailing and repeated whitespace per line, but never inside
	// fenced pre blocks where whitespace is significant.
	let inFence = false
	return out
		.join('')
		.split('\n')
		.map((line) => {
			if (line.startsWith('```')) inFence = !inFence
			if (inFence) return line.replace(/[ \t]+$/g, '')
			return line.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}/g, ' ')
		})
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/** Resolve a possibly-relative href against a base URL. Returns null for non-web schemes. */
export function resolveHref(href: string, baseUrl?: string): string | null {
	const trimmed = href.trim()
	if (!trimmed || trimmed.startsWith('#')) return null
	if (/^(javascript|data|mailto|tel|ftp):/i.test(trimmed)) return null
	try {
		const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		return url.toString()
	} catch {
		return null
	}
}

export interface PageLink {
	text: string
	href: string
}

/**
 * Extract unique http(s) links from a page, resolved against the page URL.
 * Skips anchors, javascript:, mailto:, etc.
 */
export function extractLinks(html: string, baseUrl: string): PageLink[] {
	const links: PageLink[] = []
	const seen = new Set<string>()
	const anchorRe = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi
	for (const match of html.matchAll(anchorRe)) {
		const rawHref = match[2] ?? match[3] ?? match[4] ?? ''
		const href = resolveHref(rawHref, baseUrl)
		if (!href || seen.has(href)) continue
		seen.add(href)
		const text = decodeEntities(match[4] ?? '')
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
		links.push({ text: text || href, href })
	}
	return links
}
