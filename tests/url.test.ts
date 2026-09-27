import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeUrl, urlsInText } from '../src/url.ts'

test('normalizeUrl accepts full http(s) URLs', () => {
	assert.equal(normalizeUrl('https://example.com/a?b=1').toString(), 'https://example.com/a?b=1')
	assert.equal(normalizeUrl('http://localhost:8080/x').toString(), 'http://localhost:8080/x')
})

test('normalizeUrl adds https:// to bare hosts', () => {
	assert.equal(normalizeUrl('example.com').toString(), 'https://example.com/')
	assert.equal(normalizeUrl('example.com/docs').toString(), 'https://example.com/docs')
	assert.equal(normalizeUrl('localhost:3000').toString(), 'https://localhost:3000/')
})

test('normalizeUrl rejects non-web schemes and junk', () => {
	for (const bad of ['javascript:alert(1)', 'ftp://x.com', 'file:///etc/passwd', 'data:text/html,hi', '', '   ', 'not a url with spaces']) {
		assert.throws(() => normalizeUrl(bad), bad)
	}
})

test('urlsInText finds URLs and strips trailing punctuation', () => {
	const text = 'check https://example.com/a. and also http://foo.bar/b(c) plus https://x.io/path?q=1,'
	const urls = urlsInText(text)
	assert.deepEqual(urls, ['https://example.com/a', 'http://foo.bar/b(c)', 'https://x.io/path?q=1'])
})

test('urlsInText dedupes and ignores non-urls', () => {
	assert.deepEqual(urlsInText('no links here, example.com is not a URL per regex'), [])
	assert.deepEqual(urlsInText('https://a.io https://a.io'), ['https://a.io/'])
})
