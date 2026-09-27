import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeEntities, extractLinks, extractTitle, htmlToMarkdown, resolveHref } from '../src/html.ts'

test('decodeEntities handles named, decimal, and hex entities', () => {
	assert.equal(decodeEntities('a &amp; b &lt;tag&gt; &#65; &#x42; &nbsp;end'), 'a & b <tag> A B  end')
	assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;')
})

test('extractTitle returns title text or null', () => {
	assert.equal(extractTitle('<html><head><title> My Page </title></head></html>'), 'My Page')
	assert.equal(extractTitle('<p>none</p>'), null)
})

test('htmlToMarkdown strips scripts, styles, nav, and footer', () => {
	const html = `<html><head><style>body{color:red}</style></head><body>
		<nav><a href="/menu">Menu</a></nav>
		<main><h1>Hello</h1><p>World &amp; friends</p>
		<script>alert(1)</script></main>
		<footer>copyright</footer></body></html>`
	const md = htmlToMarkdown(html)
	assert.match(md, /# Hello/)
	assert.match(md, /World & friends/)
	assert.ok(!md.includes('Menu'))
	assert.ok(!md.includes('copyright'))
	assert.ok(!md.includes('alert'))
})

test('htmlToMarkdown converts links, lists, headings, and pre', () => {
	const html = `<body>
		<h2>Section</h2>
		<ul><li>one</li><li>two</li></ul>
		<p>See <a href="/docs/page">the docs</a> and <a href="https://x.io">https://x.io</a>.</p>
		<pre>code  block\n  preserved</pre>
	</body>`
	const md = htmlToMarkdown(html, 'https://example.com/base/')
	assert.match(md, /## Section/)
	assert.match(md, /- one/)
	assert.match(md, /- two/)
	assert.match(md, /\[the docs\]\(https:\/\/example\.com\/docs\/page\)/)
	assert.match(md, /https:\/\/x\.io\//) // bare-URL link renders as text
	assert.match(md, /```\ncode {2}block\n {2}preserved\n```/)
})

test('htmlToMarkdown handles nested elements inside stripped containers', () => {
	const html = '<body><p>before</p><nav><div><span><a href="/x">deep</a></span></div></nav><p>after</p></body>'
	const md = htmlToMarkdown(html)
	assert.match(md, /before/)
	assert.match(md, /after/)
	assert.ok(!md.includes('deep'))
})

test('resolveHref resolves relative and rejects dangerous schemes', () => {
	assert.equal(resolveHref('/a', 'https://x.io/b/c'), 'https://x.io/a')
	assert.equal(resolveHref('d', 'https://x.io/b/c'), 'https://x.io/b/d')
	assert.equal(resolveHref('javascript:alert(1)', 'https://x.io'), null)
	assert.equal(resolveHref('mailto:a@b.c', 'https://x.io'), null)
	assert.equal(resolveHref('#frag', 'https://x.io'), null)
})

test('extractLinks dedupes and resolves against base URL', () => {
	const html = `<body>
		<a href="/a">First</a>
		<a href="/a">Duplicate</a>
		<a href="https://ext.io/x"> External <b>link</b> </a>
		<a href="javascript:void(0)">bad</a>
		<a href="#top">anchor</a>
	</body>`
	const links = extractLinks(html, 'https://example.com/page')
	assert.deepEqual(links, [
		{ text: 'First', href: 'https://example.com/a' },
		{ text: 'External link', href: 'https://ext.io/x' },
	])
})
