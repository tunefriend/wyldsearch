#!/usr/bin/env python3
"""Wyldsearch local server — static files + privacy-preserving search proxy.

Does not set cookies. Access logs omit the query string.
Set SEARXNG_URL to prefer a self-hosted instance.
"""

from __future__ import annotations

import html as htmlmod
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
UA_WIKI = "Wyldsearch/1.0 (https://wyldsearch.org; private search frontend)"
UA_WEB = "Mozilla/5.0 (compatible; Wyldsearch/1.0; +https://wyldsearch.org)"
SEARXNG = os.environ.get("SEARXNG_URL", "").rstrip("/")
TIMEOUT = 12
TRACKING_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
    "igshid",
    "si",
    "ref",
    "referrer",
}

PRIVACY_HEADERS = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "interest-cohort=(), browsing-topics=()",
    "Cache-Control": "no-store",
}


def clean_text(raw: str) -> str:
    raw = re.sub(r"<[^>]+>", " ", raw or "")
    raw = htmlmod.unescape(raw)
    return re.sub(r"\s+", " ", raw).strip()


def strip_tracking(url: str) -> str:
    try:
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https"):
            return url
        q = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        q = [(k, v) for k, v in q if k.lower() not in TRACKING_KEYS]
        return urllib.parse.urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(q), "")
        )
    except Exception:
        return url


def unwrap_ddg(href: str) -> str:
    href = htmlmod.unescape(href or "")
    if href.startswith("//"):
        href = "https:" + href
    try:
        parts = urllib.parse.urlsplit(href)
        if "duckduckgo.com" in parts.netloc and parts.path.startswith("/l"):
            qs = urllib.parse.parse_qs(parts.query)
            if "uddg" in qs:
                href = qs["uddg"][0]
    except Exception:
        pass
    return strip_tracking(href)


def http_get(url: str, ua: str = UA_WIKI, data: bytes | None = None) -> tuple[int, bytes]:
    headers = {"User-Agent": ua, "Accept": "*/*"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.getcode(), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b""
    except Exception:
        return 0, b""


def http_json(url: str, ua: str = UA_WIKI) -> dict | list | None:
    code, body = http_get(url, ua=ua)
    if code != 200 or not body:
        return None
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None


def wikipedia_infobox(query: str) -> dict | None:
    q = urllib.parse.quote(query)
    data = http_json(
        "https://en.wikipedia.org/w/api.php?action=query&list=search"
        f"&srsearch={q}&srlimit=1&utf8=1&format=json"
    )
    try:
        title = data["query"]["search"][0]["title"]
    except (TypeError, KeyError, IndexError):
        return None
    slug = urllib.parse.quote(title.replace(" ", "_"))
    summary = http_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}")
    if not summary or summary.get("type") == "disambiguation":
        return None
    extract = (summary.get("extract") or "").strip()
    if not extract:
        return None
    thumb = summary.get("thumbnail") or {}
    urls = (summary.get("content_urls") or {}).get("desktop") or {}
    return {
        "title": summary.get("title") or title,
        "description": summary.get("description") or "",
        "extract": extract,
        "url": urls.get("page") or f"https://en.wikipedia.org/wiki/{slug}",
        "thumbnail": thumb.get("source") or "",
        "thumbWidth": thumb.get("width") or 0,
        "thumbHeight": thumb.get("height") or 0,
    }


def wikipedia_web(query: str, page: int) -> list[dict]:
    offset = (page - 1) * 15
    q = urllib.parse.quote(query)
    data = http_json(
        "https://en.wikipedia.org/w/api.php?action=query&list=search"
        f"&srsearch={q}&srlimit=15&sroffset={offset}&utf8=1&format=json"
    )
    out = []
    for item in ((data or {}).get("query") or {}).get("search") or []:
        title = item.get("title") or ""
        slug = urllib.parse.quote(title.replace(" ", "_"))
        out.append(
            {
                "title": title,
                "url": f"https://en.wikipedia.org/wiki/{slug}",
                "snippet": clean_text(item.get("snippet") or ""),
                "source": "Wikipedia",
            }
        )
    return out


def parse_ddg_html(raw: str) -> list[dict]:
    results = []
    chunks = re.split(r'<div class="result\b', raw)
    for chunk in chunks[1:]:
        if "result--ad" in chunk[:200]:
            continue
        if "y.js" in chunk[:400]:
            continue
        m = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', chunk, re.S)
        if not m:
            continue
        url = unwrap_ddg(m.group(1))
        title = clean_text(m.group(2))
        sn = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', chunk, re.S)
        snippet = clean_text(sn.group(1)) if sn else ""
        if not url.startswith("http") or not title:
            continue
        if "duckduckgo.com" in urllib.parse.urlsplit(url).netloc:
            continue
        results.append({"title": title, "url": url, "snippet": snippet, "source": "DuckDuckGo"})
    return results


def ddg_web(query: str, page: int, news: bool = False) -> list[dict]:
    fields = {"q": query, "kl": "wt-wt"}
    if page > 1:
        fields["s"] = str((page - 1) * 30)
    if news:
        fields["iar"] = "news"
    data = urllib.parse.urlencode(fields).encode()
    code, body = http_get("https://html.duckduckgo.com/html/", ua=UA_WEB, data=data)
    if code != 200 or not body:
        return []
    return parse_ddg_html(body.decode("utf-8", "replace"))


def commons_images(query: str, page: int) -> list[dict]:
    offset = (page - 1) * 24
    q = urllib.parse.quote(query)
    data = http_json(
        "https://commons.wikimedia.org/w/api.php?action=query&generator=search"
        f"&gsrsearch={q}&gsrnamespace=6&gsrlimit=24&gsroffset={offset}"
        "&prop=imageinfo&iiprop=url|mime|size|extmetadata"
        "&iiurlwidth=400&format=json"
    )
    pages = ((data or {}).get("query") or {}).get("pages") or {}
    items = sorted(pages.values(), key=lambda p: p.get("index", 0))
    out = []
    for page_data in items:
        info = (page_data.get("imageinfo") or [{}])[0]
        mime = (info.get("mime") or "").lower()
        if not mime.startswith("image/"):
            continue
        title = (page_data.get("title") or "").replace("File:", "", 1)
        file_url = info.get("descriptionurl") or info.get("url") or ""
        thumb = info.get("thumburl") or info.get("url") or ""
        if not file_url:
            continue
        out.append(
            {
                "title": title,
                "url": file_url,
                "thumbnail": thumb,
                "snippet": "",
                "source": "Wikimedia Commons",
            }
        )
    return out


def wikinews(query: str, page: int) -> list[dict]:
    offset = (page - 1) * 15
    q = urllib.parse.quote(query)
    data = http_json(
        "https://en.wikinews.org/w/api.php?action=query&list=search"
        f"&srsearch={q}&srlimit=15&sroffset={offset}&utf8=1&format=json"
    )
    out = []
    for item in ((data or {}).get("query") or {}).get("search") or []:
        title = item.get("title") or ""
        slug = urllib.parse.quote(title.replace(" ", "_"))
        out.append(
            {
                "title": title,
                "url": f"https://en.wikinews.org/wiki/{slug}",
                "snippet": clean_text(item.get("snippet") or ""),
                "source": "Wikinews",
                "published": "",
            }
        )
    return out


def sepiasearch_videos(query: str, page: int) -> list[dict]:
    start = (page - 1) * 16
    q = urllib.parse.quote(query)
    data = http_json(
        f"https://sepiasearch.org/api/v1/search/videos?search={q}&count=16&start={start}&nsfw=false"
    )
    out = []
    for v in (data or {}).get("data") or []:
        if v.get("nsfw"):
            continue
        account = v.get("account") or {}
        host = account.get("host") or ""
        out.append(
            {
                "title": v.get("name") or "Video",
                "url": v.get("url") or "",
                "thumbnail": v.get("thumbnailUrl") or "",
                "duration": v.get("duration") or 0,
                "source": host or "PeerTube",
                "snippet": clean_text(v.get("truncatedDescription") or v.get("description") or "")[:220],
            }
        )
    return [r for r in out if r["url"]]


def searxng_search(query: str, tab: str, page: int) -> list[dict] | None:
    if not SEARXNG:
        return None
    cat = {"web": "general", "images": "images", "news": "news", "videos": "videos"}.get(tab, "general")
    q = urllib.parse.urlencode(
        {"q": query, "format": "json", "categories": cat, "pageno": str(page), "language": "en"}
    )
    code, body = http_get(f"{SEARXNG}/search?{q}", ua=UA_WIKI)
    if code != 200:
        return None
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None
    out = []
    for item in data.get("results") or []:
        url = strip_tracking(item.get("url") or item.get("iframe_src") or "")
        title = clean_text(item.get("title") or "")
        if not url or not title:
            continue
        out.append(
            {
                "title": title,
                "url": url,
                "snippet": clean_text(item.get("content") or ""),
                "thumbnail": item.get("thumbnail") or item.get("img_src") or item.get("thumbnail_src") or "",
                "source": item.get("engine") or "SearxNG",
                "published": item.get("publishedDate") or "",
                "duration": 0,
            }
        )
    return out


def merge_unique(*lists: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for group in lists:
        for item in group:
            key = (item.get("url") or "").rstrip("/")
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(item)
    return out


def do_search(query: str, tab: str, page: int) -> dict:
    query = query.strip()[:500]
    tab = tab if tab in {"web", "images", "news", "videos"} else "web"
    page = max(1, int(page or 1))
    infobox = None
    source = "fallback"

    sx = searxng_search(query, tab, page)
    if sx:
        source = "searxng"
        results = sx
        if tab == "web":
            infobox = wikipedia_infobox(query)
        return pack(query, tab, page, results, infobox, source)

    with ThreadPoolExecutor(max_workers=3) as pool:
        if tab == "web":
            f_web = pool.submit(ddg_web, query, page, False)
            f_box = pool.submit(wikipedia_infobox, query)
            f_wiki = pool.submit(wikipedia_web, query, page)
            web = f_web.result()
            infobox = f_box.result()
            wiki = f_wiki.result()
            results = merge_unique(web, wiki)
            source = "duckduckgo" if web else "wikipedia"
        elif tab == "images":
            results = pool.submit(commons_images, query, page).result()
            source = "commons"
        elif tab == "news":
            f_n = pool.submit(ddg_web, query, page, True)
            f_w = pool.submit(wikinews, query, page)
            news = f_n.result()
            wiki_n = f_w.result()
            results = merge_unique(news, wiki_n)
            source = "duckduckgo" if news else "wikinews"
        else:
            results = pool.submit(sepiasearch_videos, query, page).result()
            source = "sepiasearch"

    return pack(query, tab, page, results, infobox, source)


def pack(query, tab, page, results, infobox, source):
    labels = {
        "searxng": "SearxNG",
        "duckduckgo": "Web results",
        "wikipedia": "Wikipedia",
        "commons": "Wikimedia Commons",
        "wikinews": "Wikinews",
        "sepiasearch": "PeerTube",
        "fallback": "Results",
    }
    return {
        "query": query,
        "tab": tab,
        "page": page,
        "results": results,
        "infobox": infobox,
        "hasMore": len(results) >= 8,
        "source": source,
        "sourceLabel": labels.get(source, "Results"),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_message(self, fmt, *args):
        msg = fmt % args
        msg = re.sub(r"\?.*?(?=\s|$)", "", msg)
        sys.stderr.write("%s - %s\n" % (self.address_string(), msg))

    def end_headers(self):
        for k, v in PRIVACY_HEADERS.items():
            if k == "Cache-Control" and not self.path.startswith("/api/"):
                self.send_header("Cache-Control", "public, max-age=300")
                continue
            self.send_header(k, v)
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, POST, HEAD, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            return self.json({"ok": True, "searxng": bool(SEARXNG)})
        if parsed.path == "/api/search":
            qs = urllib.parse.parse_qs(parsed.query)
            q = (qs.get("q") or [""])[0]
            t = (qs.get("t") or ["web"])[0]
            p = (qs.get("p") or ["1"])[0]
            return self.json(do_search(q, t, p))
        self.path = parsed.path or "/"
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/search":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            self.send_error(413)
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8", "replace") or "{}")
        except json.JSONDecodeError:
            return self.json({"error": "Invalid JSON"}, 400)
        q = str(body.get("q") or "")
        t = str(body.get("t") or "web")
        p = body.get("p") or 1
        return self.json(do_search(q, t, p))

    def json(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    host = "127.0.0.1"
    port = 8787
    args = sys.argv[1:]
    if "--host" in args:
        host = args[args.index("--host") + 1]
    if "--port" in args:
        port = int(args[args.index("--port") + 1])
    os.chdir(PUBLIC)
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Wyldsearch → http://{host}:{port}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
