# Deploy Wyldsearch

Same pattern as TuneFriend / On-Call Scheduler: Cloudflare Worker + static
assets + edge API. Your PC does not need to stay on.

## Live

**Primary:** **https://wyldsearch.org**  
**Also:** https://www.wyldsearch.org  
**Also:** https://wyldsearch.tunefriend-schedules.workers.dev

## 1. Preview locally

```bash
cd /home/james/wyldsearch
./start.sh
# http://127.0.0.1:8787
```

## 2. Redeploy

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
cd /home/james/wyldsearch
npx wrangler deploy
```

Uses `CLOUDFLARE_API_TOKEN` in the environment. Do not put tokens in the repo.

## SearxNG on a VPS (later)

On the Worker:

```toml
[vars]
SEARXNG_URL = "https://search.your-vps.example"
```

Or locally:

```bash
SEARXNG_URL=https://search.your-vps.example ./start.sh
```

The instance must allow `format=json`.

Google, Bing, Startpage, Qwant, and Yahoo in Settings query **that instance** (`engines=google` and so on). Wyldsearch does not scrape those sites from Cloudflare.

## Optional official APIs

Do not put keys in git. Locally use environment variables; on Cloudflare use secrets:

```bash
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put BING_API_KEY
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put GOOGLE_CSE_CX
```

| Secret | What it unlocks |
|---|---|
| `BRAVE_API_KEY` | Brave Search API (web, images, news, videos) |
| `BING_API_KEY` | Bing Web Search API v7, if you still have an Azure key |
| `GOOGLE_API_KEY` + `GOOGLE_CSE_CX` | Google Programmable Search (web + images). Google is retiring this JSON API on 1 Jan 2027. |

Without those keys, checking Google/Bing/Brave still works **if** SearxNG is connected.
