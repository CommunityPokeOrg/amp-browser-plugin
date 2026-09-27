# amp-browser-plugin

Web browser plugin for [Amp](https://ampcode.com) built on the
[Amp Plugin API](https://ampcode.com/docs/plugin-api). Gives the agent real
browsing capabilities: fetch pages as readable markdown, search the web, list
page links, take real screenshots through headless Chrome, and open URLs in
your browser.

## Tools

| Tool | What it does |
| --- | --- |
| `browser_fetch` | GETs a URL and returns readable markdown (headings, links, lists preserved; nav/footer/script/style stripped). Pass `format: "html"` for the raw document. |
| `browser_search` | DuckDuckGo HTML search — no API key needed. Returns titles, URLs, snippets. |
| `browser_links` | Lists a page's outbound links resolved to absolute URLs, with an optional `filter` substring. |
| `browser_screenshot` | Renders a URL in headless Chrome and returns a PNG image block (uploaded via `amp.attachments`, base64 fallback). Use for JS-rendered pages or visual checks. |
| `browser_open` | Opens a URL in your default browser via `amp.system.open`. |

## Commands (command palette)

- `browser: Browse URL` — prompt for a URL, fetch it, and append the readable text to the current thread.
- `browser: Open URL in browser` — prompt for a URL and open it in your browser.

## Event hook

- `agent.start` — when your prompt contains URLs, the plugin appends a hidden
  message telling the agent the browser tools are available for inspecting them.

## Install

Directory plugin — clone it into a plugin location and reload:

```sh
# Personal (all projects on this machine):
git clone https://github.com/CommunityPokeOrg/amp-browser-plugin ~/.config/amp/plugins/amp-browser

# Or project-only:
mkdir -p .amp/plugins && git clone https://github.com/CommunityPokeOrg/amp-browser-plugin .amp/plugins/amp-browser
```

Then run `plugins: reload` from the Amp command palette (Ctrl+O). Verify with
`plugins: list` — you should see the five `browser_*` tools and two `browser:`
commands.

`browser_screenshot` needs a Chrome/Chromium binary on PATH
(`google-chrome`, `chromium`, …) or a standard macOS install location.
Everything else has zero dependencies.

## Development

Requires Node ≥ 23.6 (tests run on Node's built-in runner with native TypeScript
type-stripping — the same `import type` erasure Bun applies inside Amp).

```sh
npm install        # dev deps: typescript, @types/node
npm test           # node --test
npm run typecheck  # tsc --noEmit against the vendored @ampcode/plugin types
```

Layout:

```
index.ts          plugin entry — tool/command/event registration
src/url.ts        URL normalization + URL detection in text
src/http.ts       fetch with browser UA, byte cap, timeout
src/html.ts       dependency-free HTML → markdown, title, link extraction
src/search.ts     DuckDuckGo HTML search + result parser
src/chrome.ts     headless Chrome discovery + screenshot capture
types/plugin.d.ts vendored @ampcode/plugin type reference (from the docs)
tests/            node:test suite (includes real headless-Chrome screenshots)
```

`types/plugin.d.ts` is the generated `@ampcode/plugin` reference from
<https://ampcode.com/docs/plugin-api> wrapped in a `declare module` so `tsc`
can check the plugin without the real package. `import type` statements are
erased at runtime, so Amp needs no npm dependencies.
