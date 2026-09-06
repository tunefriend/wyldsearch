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

Settings can then include Google, Bing, Brave, Startpage, Qwant, and Yahoo **through that instance**. This app does not scrape google.com or bing.com. Optional official keys (`BRAVE_API_KEY`, `BING_API_KEY`, `GOOGLE_API_KEY` + `GOOGLE_CSE_CX`) are documented in [DEPLOY.md](DEPLOY.md).

## Publish

See [DEPLOY.md](DEPLOY.md). Custom domain `wyldsearch.org` attaches after
the Worker is live.

## License

Wyldsearch is free software under the [GNU General Public License
v3.0 or later](LICENSE).
