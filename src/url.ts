/**
 * URL parsing and validation shared by the browser tools.
 */

/** Matches a URL with an explicit scheme, e.g. `https://example.com`. */
const SCHEMED = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

/**
 * Matches an input that looks like a bare host (optionally with port, path,
 * query or fragment): `example.com`, `localhost:3000/docs`, `127.0.0.1`.
 * Deliberately strict — anything else (spaces, `javascript:` etc.) is rejected.
 */
const BARE_HOST = /^[a-zA-Z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/

/**
 * Normalize user input into an http(s) URL.
 *
 * Accepts full `http://`/`https://` URLs and bare hostnames, to which it adds
 * `https://`. Throws on anything else, including non-web schemes.
 */
export function normalizeUrl(input: string): URL {
	const raw = input.trim()
	if (!raw) {
		throw new Error('Empty URL.')
	}

	const candidate = SCHEMED.test(raw) ? raw : BARE_HOST.test(raw) ? `https://${raw}` : raw

	let url: URL
	try {
		url = new URL(candidate)
	} catch {
		throw new Error(`Invalid URL: ${input}`)
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Only http: and https: URLs are supported, got ${url.protocol}`)
	}
	if (!url.hostname) {
		throw new Error(`URL has no host: ${input}`)
	}
	return url
}

/**
 * Extract absolute http(s) URLs found in free text (e.g. a user prompt).
 * Strips common trailing punctuation that sticks to URLs in prose.
 */
export function urlsInText(text: string): string[] {
	const matches = text.match(/https?:\/\/[^\s<>"'`\[\]{}]+/g) ?? []
	const urls: string[] = []
	for (const match of matches) {
		// Strip trailing prose punctuation, and trailing ')' when unbalanced
		// (e.g. a URL wrapped in parentheses).
		let cleaned = match.replace(/[.,;:!?'"\]]+$/, '')
		while (
			cleaned.endsWith(')') &&
			(cleaned.match(/\)/g)?.length ?? 0) > (cleaned.match(/\(/g)?.length ?? 0)
		) {
			cleaned = cleaned.slice(0, -1)
		}
		try {
			const url = new URL(cleaned)
			urls.push(url.toString())
		} catch {
			// skip malformed matches
		}
	}
	return [...new Set(urls)]
}
