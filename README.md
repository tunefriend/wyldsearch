# Wyldsearch

Private search homepage for **wyldsearch.org**.

No tracking. No profiles. No ads. No accounts. No cookies.

This is the front end. Real SearxNG metasearch still needs a VPS — set
`SEARXNG_URL` when you have one. Until then the proxy fans out to
DuckDuckGo HTML, Wikipedia, Wikimedia Commons, Wikinews, and SepiaSearch
(PeerTube). Queries are not stored. Access logs strip query strings.

## Preview

**https://wyldsearch.org**

Also: https://www.wyldsearch.org · https://wyldsearch.tunefriend-schedules.workers.dev

Local:

```bash
cd wyldsearch
./start.sh
# http://127.0.0.1:8787
```

## Search API

`POST /api/search` with `{ "q": "moss", "t": "web", "p": 1 }`

Tabs: `web` · `images` · `news` · `videos`

## Attach SearxNG

```bash
export SEARXNG_URL="https://search.your-vps.example"
./start.sh
```

Enable JSON output on the instance (`search.formats: [html, json]`).

## Publish

See [DEPLOY.md](DEPLOY.md). Custom domain `wyldsearch.org` attaches after
the Worker is live.
