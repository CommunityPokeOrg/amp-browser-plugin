/**
 * Web search via the DuckDuckGo HTML endpoint — no API key required.
 * Structured so the parser is unit-testable against a fixture.
 */

import { decodeEntities } from './html.ts'
import { DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from './http.ts'

const ENDPOINT = 'https://html.duckduckgo.com/html/'

export interface SearchResult {
	title: string
	url: string
	snippet: string
}

/**
 * Parse the DuckDuckGo HTML response. Each result is an anchor with class
 * `result__a` whose href is a `/l/?uddg=<url-encoded-target>` redirect,
 * followed by a `.result__snippet` blurb.
 */
export function parseSearchResults(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = []
	const resultRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
	const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
	const snippets: string[] = []
	for (const m of html.matchAll(snippetRe)) {
		snippets.push(stripTags(m[1] ?? m[2] ?? ''))
	}

	let i = 0
	for (const m of html.matchAll(resultRe)) {
		const url = unwrapDuckDuckGoRedirect(m[1] ?? '')
		if (!url) continue
		results.push({
			title: stripTags(m[2] ?? ''),
			url,
			snippet: snippets[i] ?? '',
		})
		i++
		if (results.length >= maxResults) break
	}
	return results
}

function stripTags(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/** Extract the real target URL from a DuckDuckGo `/l/?uddg=...` redirect link. */
export function unwrapDuckDuckGoRedirect(href: string): string | null {
	// Only accept things that look like links: //host, /path, http(s)://...
	if (!/^(?:https?:)?\/\//i.test(href) && !href.startsWith('/')) return null
	try {
		const url = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com')
		const target = url.searchParams.get('uddg')
		if (target) {
			const decoded = new URL(target)
			if (decoded.protocol === 'http:' || decoded.protocol === 'https:') {
				return decoded.toString()
			}
			return null
		}
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return url.toString()
		}
		return null
	} catch {
		return null
	}
}

export interface SearchOptions {
	maxResults?: number
	timeoutMs?: number
	fetchImpl?: typeof fetch
}

/** Run a web search and return structured results. Throws on network failure. */
export async function searchWeb(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
	const maxResults = Math.max(1, Math.min(options.maxResults ?? 5, 20))
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const fetchImpl = options.fetchImpl ?? fetch

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const body = new URLSearchParams({ q: query })
		const response = await fetchImpl(ENDPOINT, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				'user-agent': DEFAULT_USER_AGENT,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
		})
		if (!response.ok) {
			throw new Error(`Search failed: HTTP ${response.status}`)
		}
		const html = await response.text()
		return parseSearchResults(html, maxResults)
	} finally {
		clearTimeout(timer)
	}
}
