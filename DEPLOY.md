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
