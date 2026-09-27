/**
 * Headless-Chrome screenshots. Amp plugins run under Bun; `node:child_process`,
 * `node:fs`, `node:os`, and `node:path` all work there and under Node for tests.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeUrl } from './url.ts'

/** Candidate Chrome/Chromium executables, in preference order. */
export const CHROME_CANDIDATES = [
	'google-chrome',
	'google-chrome-stable',
	'chromium',
	'chromium-browser',
	'chrome',
	'brave-browser',
	'microsoft-edge',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
] as const

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
			const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
			resolve({ code, stdout: String(stdout), stderr: String(stderr) })
		})
	})
}

/**
 * Find the first working Chrome/Chromium binary on this machine.
 * Returns null when none is installed.
 */
export async function findChrome(candidates: readonly string[] = CHROME_CANDIDATES): Promise<string | null> {
	for (const candidate of candidates) {
		try {
			const result = await run(candidate, ['--version'], 5_000)
			if (result.code === 0 && /chrom/i.test(result.stdout + result.stderr)) {
				return candidate
			}
		} catch {
			// not installed — keep looking
		}
	}
	return null
}

export interface ScreenshotOptions {
	width?: number
	height?: number
	timeoutMs?: number
	/** Override binary lookup (tests / custom installs). */
	chromePath?: string
}

/**
 * Render a URL in headless Chrome and return PNG bytes.
 * Throws when Chrome is unavailable or the capture fails.
 */
export async function captureScreenshot(input: string, options: ScreenshotOptions = {}): Promise<Buffer> {
	const url = normalizeUrl(input)
	const chrome = options.chromePath ?? (await findChrome())
	if (!chrome) {
		throw new Error(
			'No Chrome/Chromium binary found. Install Chrome, or use browser_fetch for a text-only read.',
		)
	}

	const width = options.width ?? 1280
	const height = options.height ?? 800
	const timeoutMs = options.timeoutMs ?? 30_000
	const dir = await mkdtemp(join(tmpdir(), 'amp-browser-'))
	const file = join(dir, 'shot.png')
	try {
		const result = await run(
			chrome,
			[
				'--headless=new',
				'--disable-gpu',
				'--disable-dev-shm-usage',
				'--no-first-run',
				'--hide-scrollbars',
				'--virtual-time-budget=10000',
				`--window-size=${width},${height}`,
				`--screenshot=${file}`,
				url.toString(),
			],
			timeoutMs,
		)
		const png = await readFile(file).catch(() => null)
		if (!png || png.length === 0) {
			throw new Error(
				`Chrome exited ${result.code} without producing a screenshot: ${result.stderr.trim().slice(0, 300)}`,
			)
		}
		return png
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {})
	}
}
