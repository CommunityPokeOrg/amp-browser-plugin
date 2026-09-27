import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSearchResults, unwrapDuckDuckGoRedirect } from '../src/search.ts'

// Representative slice of a real html.duckduckgo.com response.
const FIXTURE = `
<div class="results">
	<div class="result results_links results_links_deep web-result">
		<h2 class="result__title">
			<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example Docs</a>
		</h2>
		<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">The official &lt;docs&gt; for example.</a>
	</div>
	<div class="result results_links results_links_deep web-result">
		<h2 class="result__title">
			<a rel="nofollow" class="result__a" href="https://direct.io/page">Direct Link &amp; More</a>
		</h2>
		<a class="result__snippet" href="https://direct.io/page">Second result snippet.</a>
	</div>
</div>`

test('parseSearchResults extracts titles, unwrapped URLs, and snippets', () => {
	const results = parseSearchResults(FIXTURE, 10)
	assert.equal(results.length, 2)
	assert.deepEqual(results[0], {
		title: 'Example Docs',
		url: 'https://example.com/docs',
		snippet: 'The official <docs> for example.',
	})
	assert.deepEqual(results[1], {
		title: 'Direct Link & More',
		url: 'https://direct.io/page',
		snippet: 'Second result snippet.',
	})
})

test('parseSearchResults respects maxResults', () => {
	assert.equal(parseSearchResults(FIXTURE, 1).length, 1)
	assert.equal(parseSearchResults('<p>nothing</p>', 5).length, 0)
})

test('unwrapDuckDuckGoRedirect decodes uddg and rejects bad targets', () => {
	assert.equal(
		unwrapDuckDuckGoRedirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.io%2Fx'),
		'https://a.io/x',
	)
	assert.equal(unwrapDuckDuckGoRedirect('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)'), null)
	assert.equal(unwrapDuckDuckGoRedirect('not a url at all ::'), null)
})
