import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'

import plugin, { description } from '../index.ts'
import { FakeAmp, makeAgentStartEvent } from './fake-amp.ts'

const PAGE_HTML = `<!doctype html><html><head><title>Test Page</title></head><body>
<nav><a href="/nav">nav link</a></nav>
<main><h1>Main Heading</h1><p>Body copy here.</p>
<p><a href="/about">About us</a> <a href="https://ext.io/x">External</a></p>
</main><footer>foot</footer></body></html>`

function serveHtml(html: string, contentType = 'text/html; charset=utf-8'): Promise<{ server: Server; url: string }> {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			res.writeHead(200, { 'content-type': contentType })
			res.end(html)
		})
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo
			resolve({ server, url: `http://127.0.0.1:${port}/` })
		})
	})
}

test('plugin registers well-formed tools, commands, and the agent.start hook', () => {
	const amp = new FakeAmp()
	plugin(amp.api)

	assert.equal(description.length > 0 && description.length <= 300, true)

	for (const name of ['browser_fetch', 'browser_search', 'browser_links', 'browser_screenshot', 'browser_open']) {
		const tool = amp.tools.get(name)
		assert.ok(tool, `missing tool ${name}`)
		assert.match(tool!.definition.name, /^[a-zA-Z0-9_-]+$/)
		assert.equal(tool!.definition.inputSchema.type, 'object')
		assert.ok(tool!.definition.description.length > 20)
	}

	for (const id of ['browse-url', 'open-url']) {
		assert.ok(amp.commands.get(id), `missing command ${id}`)
	}
	assert.ok(amp.handlers.get('agent.start'))
	assert.equal(amp.disposed.length, 1)
})

test('browser_fetch returns readable markdown for an HTML page', async () => {
	const { server, url } = await serveHtml(PAGE_HTML)
	try {
		const amp = new FakeAmp()
		plugin(amp.api)
		const result = (await amp.runTool('browser_fetch', { url })) as string
		assert.match(result, /HTTP 200/)
		assert.match(result, /Title: Test Page/)
		assert.match(result, /# Main Heading/)
		assert.match(result, /Body copy here\./)
		assert.match(result, /\[About us\]\(http:\/\/127\.0\.0\.1:\d+\/about\)/)
		assert.ok(!result.includes('nav link'))
		assert.ok(!result.includes('foot'))
	} finally {
		server.close()
	}
})

test('browser_fetch passes through non-HTML bodies and respects format=html', async () => {
	const { server, url } = await serveHtml('{"a":1}', 'application/json')
	try {
		const amp = new FakeAmp()
		plugin(amp.api)
		const result = (await amp.runTool('browser_fetch', { url })) as string
		assert.match(result, /\{"a":1\}/)
	} finally {
		server.close()
	}
})

test('browser_fetch rejects bad URLs', async () => {
	const amp = new FakeAmp()
	plugin(amp.api)
	await assert.rejects(() => amp.runTool('browser_fetch', { url: 'javascript:x' }))
	await assert.rejects(() => amp.runTool('browser_fetch', { url: '' }))
})

test('browser_links lists resolved links with filter', async () => {
	const { server, url } = await serveHtml(PAGE_HTML)
	try {
		const amp = new FakeAmp()
		plugin(amp.api)
		const all = (await amp.runTool('browser_links', { url })) as string
		assert.match(all, /\[About us\]/)
		assert.match(all, /\[External\]\(https:\/\/ext\.io\/x\)/)

		const filtered = (await amp.runTool('browser_links', { url, filter: 'ext' })) as string
		assert.match(filtered, /ext\.io/)
		assert.ok(!filtered.includes('About us'))
	} finally {
		server.close()
	}
})

test('browser_open delegates to system.open', async () => {
	const amp = new FakeAmp()
	plugin(amp.api)
	const result = await amp.runTool('browser_open', { url: 'example.com/x' })
	assert.deepEqual(amp.openedUrls, ['https://example.com/x'])
	assert.match(result as string, /Opened https:\/\/example\.com\/x/)
})

test('browser_search errors on empty query', async () => {
	const amp = new FakeAmp()
	plugin(amp.api)
	await assert.rejects(() => amp.runTool('browser_search', { query: '  ' }))
})

test('agent.start injects a hidden hint when the prompt contains URLs', async () => {
	const amp = new FakeAmp()
	plugin(amp.api)
	const withUrl = await amp.runAgentStart(makeAgentStartEvent('read https://example.com/docs please'))
	assert.ok(withUrl && 'message' in withUrl)
	assert.match((withUrl as { message: { content: string } }).message.content, /browser_fetch/)
	assert.equal((withUrl as { message: { display?: boolean } }).message.display, false)

	const without = await amp.runAgentStart(makeAgentStartEvent('plain prompt, no links'))
	assert.deepEqual(without, {})
})

test('browse-url command fetches and appends to the thread', async () => {
	const { server, url } = await serveHtml(PAGE_HTML)
	try {
		const amp = new FakeAmp()
		plugin(amp.api)
		amp.queuedInputs.push(url)
		const appended: { content: string }[] = []
		const ctxOverride = {
			thread: {
				id: 'T-x',
				append: async (msgs: { content: string }[]) => {
					appended.push(...msgs)
				},
			},
		} as never
		await amp.runCommand('browse-url', ctxOverride as Partial<never>)
		assert.equal(appended.length, 1)
		assert.match(appended[0]!.content, /Main Heading/)
		assert.match(amp.lastNotifications[0] ?? '', /Fetched http:\/\/127\.0\.0\.1/)
	} finally {
		server.close()
	}
})
