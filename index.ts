import type { PluginAPI, PluginToolResult } from '@ampcode/plugin'

import { captureScreenshot } from './src/chrome.ts'
import { extractLinks, extractTitle, htmlToMarkdown } from './src/html.ts'
import { fetchPage } from './src/http.ts'
import { searchWeb } from './src/search.ts'
import { normalizeUrl, urlsInText } from './src/url.ts'

export const description =
	'Web browser tools for Amp: fetch pages as readable text, search the web, list page links, take real screenshots via headless Chrome, and open URLs.'

const MAX_TEXT_CHARS = 24_000

function asString(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text
	return `${text.slice(0, limit)}\n\n[truncated at ${limit} chars — fetch again with a different selector or maxChars]`
}

function requireUrl(input: Record<string, unknown>): string {
	const raw = asString(input.url)
	if (!raw.trim()) {
		throw new Error('Missing required "url" parameter.')
	}
	return normalizeUrl(raw).toString()
}

export default function (amp: PluginAPI) {
	amp.logger.log('[browser] plugin initialized')

	amp.registerTool({
		name: 'browser_fetch',
		title: 'Fetch web page',
		transcriptGroup: { active: 'Fetching web page', complete: 'Fetched web page' },
		description:
			'Fetch a web page over HTTP and return its readable text as markdown. Use for reading documentation, articles, and pages the user links. For JavaScript-heavy pages that render empty, use browser_screenshot instead.',
		inputSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'URL to fetch (https:// is added if omitted).' },
				maxChars: {
					type: 'number',
					description: `Maximum characters of page text to return (default ${MAX_TEXT_CHARS}).`,
				},
				format: {
					type: 'string',
					enum: ['text', 'html'],
					description: '"text" (default) returns readable markdown; "html" returns the raw document.',
				},
			},
			required: ['url'],
		},
		async execute(input) {
			const url = requireUrl(input)
			const maxChars = asNumber(input.maxChars, MAX_TEXT_CHARS)
			const format = asString(input.format) || 'text'
			const page = await fetchPage(url)
			const isHtml = page.contentType.includes('html') || /<html[\s>]/i.test(page.body.slice(0, 2000))

			if (format === 'html' || !isHtml) {
				const label = page.truncated ? ' (download truncated)' : ''
				return `HTTP ${page.status} ${page.url}${label}\n\n${truncate(page.body, maxChars)}`
			}

			const title = extractTitle(page.body)
			const text = htmlToMarkdown(page.body, page.url)
			const header = [`HTTP ${page.status} ${page.url}`]
			if (title) header.push(`Title: ${title}`)
			if (page.truncated) header.push('(download truncated)')
			if (!text.trim()) {
				header.push(
					'(no readable text extracted — the page may require JavaScript; try browser_screenshot)',
				)
			}
			return `${header.join('\n')}\n\n${truncate(text, maxChars)}`
		},
	})

	amp.registerTool({
		name: 'browser_search',
		title: 'Search the web',
		transcriptGroup: { active: 'Searching the web', complete: 'Searched the web' },
		description:
			'Search the web with DuckDuckGo and return titles, URLs, and snippets. No API key required. Follow up with browser_fetch to read a result.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Search query.' },
				maxResults: { type: 'number', description: 'Number of results, 1-20 (default 5).' },
			},
			required: ['query'],
		},
		async execute(input) {
			const query = asString(input.query).trim()
			if (!query) throw new Error('Missing required "query" parameter.')
			const maxResults = asNumber(input.maxResults, 5)
			const results = await searchWeb(query, { maxResults })
			if (results.length === 0) {
				return `No results for "${query}".`
			}
			return results
				.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
				.join('\n\n')
		},
	})

	amp.registerTool({
		name: 'browser_links',
		title: 'List page links',
		transcriptGroup: { active: 'Listing page links', complete: 'Listed page links' },
		description:
			'Fetch a page and list its outbound links with anchor text, resolved to absolute URLs. Useful for navigating docs sites or finding downloads.',
		inputSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'Page URL to extract links from.' },
				filter: {
					type: 'string',
					description: 'Optional substring filter applied to link text and URL (case-insensitive).',
				},
				maxLinks: { type: 'number', description: 'Maximum links to return (default 50).' },
			},
			required: ['url'],
		},
		async execute(input) {
			const url = requireUrl(input)
			const filter = asString(input.filter).toLowerCase()
			const maxLinks = asNumber(input.maxLinks, 50)
			const page = await fetchPage(url)
			let links = extractLinks(page.body, page.url)
			if (filter) {
				links = links.filter(
					(l) => l.text.toLowerCase().includes(filter) || l.href.toLowerCase().includes(filter),
				)
			}
			const shown = links.slice(0, Math.max(1, maxLinks))
			const suffix = links.length > shown.length ? `\n\n(${links.length - shown.length} more links omitted)` : ''
			return (
				`${shown.length} link(s) on ${page.url}:\n\n` +
				shown.map((l) => `- [${l.text}](${l.href})`).join('\n') +
				suffix
			)
		},
	})

	amp.registerTool({
		name: 'browser_screenshot',
		title: 'Screenshot web page',
		transcriptGroup: { active: 'Screenshotting web page', complete: 'Screenshot web page' },
		description:
			'Render a URL in headless Chrome and return a PNG screenshot. Use for JavaScript-rendered pages, visual verification of web UI, or when browser_fetch returns empty content.',
		inputSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'URL to render.' },
				width: { type: 'number', description: 'Viewport width in px (default 1280).' },
				height: { type: 'number', description: 'Viewport height in px (default 800).' },
			},
			required: ['url'],
		},
		async execute(input): Promise<PluginToolResult> {
			const url = requireUrl(input)
			const png = await captureScreenshot(url, {
				width: asNumber(input.width, 1280),
				height: asNumber(input.height, 800),
			})
			try {
				const { url: imageUrl } = await amp.attachments.upload({ data: png, mimeType: 'image/png' })
				return [
					{ type: 'text', text: `Screenshot of ${url}` },
					{ type: 'image', mimeType: 'image/png', url: imageUrl },
				]
			} catch {
				return [
					{ type: 'text', text: `Screenshot of ${url}` },
					{ type: 'image', mimeType: 'image/png', data: Buffer.from(png).toString('base64') },
				]
			}
		},
	})

	amp.registerTool({
		name: 'browser_open',
		title: 'Open URL in browser',
		transcriptGroup: { active: 'Opening URL in browser', complete: 'Opened URL in browser' },
		description:
			"Open a URL in the user's default web browser. Use when the user asks to open a page, or when they should look at something themselves.",
		inputSchema: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'URL to open in the system browser.' },
			},
			required: ['url'],
		},
		async execute(input) {
			const url = requireUrl(input)
			await amp.system.open(url)
			return `Opened ${url} in the browser.`
		},
	})

	amp.registerCommand(
		'browse-url',
		{
			title: 'Browse URL',
			category: 'browser',
			description: 'Fetch a URL and append its readable text to the current thread.',
		},
		async (ctx) => {
			const input = await ctx.ui.input({
				title: 'Browse URL',
				helpText: 'Enter a URL to fetch and append to this thread.',
				submitButtonText: 'Fetch',
			})
			if (!input) return

			let page
			try {
				page = await fetchPage(input)
			} catch (error) {
				await ctx.ui.notify(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`)
				return
			}
			const text = htmlToMarkdown(page.body, page.url)
			const title = extractTitle(page.body)
			await ctx.ui.notify(`Fetched ${page.url}${title ? ` — ${title}` : ''} (${text.length} chars).`)

			if (!ctx.thread) {
				await ctx.ui.notify('No active thread. Send any message to create one, then re-run this command.')
				return
			}
			await ctx.thread.append([
				{
					type: 'user-message',
					content: `Content of ${page.url}${title ? ` (${title})` : ''}:\n\n${truncate(text, MAX_TEXT_CHARS)}`,
				},
			])
		},
	)

	amp.registerCommand(
		'open-url',
		{
			title: 'Open URL in browser',
			category: 'browser',
			description: 'Open a URL in your default web browser.',
		},
		async (ctx) => {
			const input = await ctx.ui.input({
				title: 'Open URL',
				helpText: 'Enter a URL to open in your default browser.',
				submitButtonText: 'Open',
			})
			if (!input) return
			try {
				await ctx.system.open(normalizeUrl(input))
			} catch (error) {
				await ctx.ui.notify(`Could not open URL: ${error instanceof Error ? error.message : String(error)}`)
			}
		},
	)

	// When a turn starts with URLs in the prompt, give the agent a hidden hint
	// that the browser tools exist for inspecting them.
	amp.on('agent.start', (event) => {
		const urls = urlsInText(event.message)
		if (urls.length === 0) return {}
		return {
			message: {
				content:
					`This prompt mentions ${urls.length} URL(s): ${urls.join(', ')}. ` +
					'Use browser_fetch to read page text, browser_screenshot to render it visually, or browser_links to enumerate its links.',
				display: false,
			},
		}
	})

	amp.onDispose(() => {
		amp.logger.log('[browser] plugin disposing')
	})
}
