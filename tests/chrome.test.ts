import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'

import { captureScreenshot, findChrome } from '../src/chrome.ts'
import plugin from '../index.ts'
import { FakeAmp } from './fake-amp.ts'

const chrome = await findChrome()

test('findChrome discovers a working binary', { skip: !chrome }, () => {
	assert.ok(chrome)
})

test('captureScreenshot produces a PNG for a local page', { skip: !chrome }, async () => {
	const server: Server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/html' })
		res.end('<html><body><h1>Screenshot me</h1></body></html>')
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	try {
		const png = await captureScreenshot(`http://127.0.0.1:${port}/`, { width: 640, height: 480 })
		// PNG magic bytes
		assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		assert.ok(png.length > 1000)
	} finally {
		server.close()
	}
})

test('browser_screenshot tool returns an image block', { skip: !chrome }, async () => {
	const server: Server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/html' })
		res.end('<html><body><h1>Hi</h1></body></html>')
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	try {
		const amp = new FakeAmp()
		plugin(amp.api)
		const result = (await amp.runTool('browser_screenshot', {
			url: `http://127.0.0.1:${port}/`,
			width: 320,
			height: 240,
		})) as { type: string; mimeType?: string; url?: string; data?: string }[]
		assert.ok(Array.isArray(result))
		const image = result.find((b) => b.type === 'image')
		assert.ok(image)
		assert.equal(image!.mimeType, 'image/png')
		// upload path returns a URL; when upload fails it falls back to base64
		assert.ok(image!.url === 'https://uploads.example.com/shot.png' || (image!.data?.length ?? 0) > 100)
	} finally {
		server.close()
	}
})
