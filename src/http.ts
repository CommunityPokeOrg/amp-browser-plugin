/**
 * Page fetching over HTTP with a browser user agent, byte cap, and timeout.
 */

import { normalizeUrl } from './url.ts'

export const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 AmpBrowserPlugin/1.0'

export const DEFAULT_MAX_BYTES = 512 * 1024
export const DEFAULT_TIMEOUT_MS = 20_000

export interface FetchedPage {
	/** Final URL after redirects. */
	url: string
	status: number
	contentType: string
	/** Response body decoded as UTF-8 text, capped at maxBytes. */
	body: string
	/** True when the body was truncated to maxBytes. */
	truncated: boolean
}

export interface FetchOptions {
	maxBytes?: number
	timeoutMs?: number
	headers?: Record<string, string>
	/** Injectable for tests; defaults to global fetch. */
	fetchImpl?: typeof fetch
}

/** Fetch a URL and return the decoded body. Throws on invalid URL or network failure. */
export async function fetchPage(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
	const url = normalizeUrl(input)
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const fetchImpl = options.fetchImpl ?? fetch

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetchImpl(url.toString(), {
			signal: controller.signal,
			redirect: 'follow',
			headers: {
				'user-agent': DEFAULT_USER_AGENT,
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
				'accept-language': 'en-US,en;q=0.9',
				...options.headers,
			},
		})

		const contentType = response.headers.get('content-type') ?? ''
		const buffer = await response.arrayBuffer()
		const bytes = new Uint8Array(buffer)
		const truncated = bytes.byteLength > maxBytes
		const body = new TextDecoder('utf-8', { fatal: false }).decode(
			truncated ? bytes.subarray(0, maxBytes) : bytes,
		)

		return {
			url: response.url || url.toString(),
			status: response.status,
			contentType,
			body,
			truncated,
		}
	} finally {
		clearTimeout(timer)
	}
}
