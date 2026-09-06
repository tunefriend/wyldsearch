/**
 * Cloudflare Worker — Wyldsearch static site + search proxy.
 * No cookies. No query logging. Optional SEARXNG_URL binding/var.
 */

const UA_WIKI = "Wyldsearch/1.0 (https://wyldsearch.org; private search frontend)";
const UA_WEB = "Mozilla/5.0 (compatible; Wyldsearch/1.0; +https://wyldsearch.org)";
const TRACKING = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "fbclid", "mc_cid", "mc_eid", "igshid", "si", "ref", "referrer",
]);

const PRIVACY = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "interest-cohort=(), browsing-topics=()",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...PRIVACY,
    },
  });
}

function cleanText(raw) {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTracking(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return url;
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING.has(k.toLowerCase())) u.searchParams.delete(k);
    });
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function unwrapDdg(href) {
  href = cleanText(href);
  if (href.startsWith("//")) href = "https:" + href;
  try {
    const u = new URL(href);
    if (u.hostname.includes("duckduckgo.com") && u.pathname.startsWith("/l")) {
      const target = u.searchParams.get("uddg");
      if (target) href = target;
    }
  } catch {
    /* keep */
  }
  return stripTracking(href);
}

async function fetchText(url, { ua = UA_WIKI, body = null } = {}) {
  const headers = { "User-Agent": ua, Accept: "*/*" };
  const init = { method: body ? "POST" : "GET", headers, redirect: "follow" };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = body;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchJson(url, ua = UA_WIKI) {
  try {
    const { ok, text } = await fetchText(url, { ua });
    if (!ok || !text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function wikipediaInfobox(query) {
  const data = await fetchJson(
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(query) +
      "&srlimit=1&utf8=1&format=json"
  );
  const title = data?.query?.search?.[0]?.title;
  if (!title) return null;
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`);
  if (!summary || summary.type === "disambiguation") return null;
  const extract = (summary.extract || "").trim();
  if (!extract) return null;
  const thumb = summary.thumbnail || {};
  const page = summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`;
  return {
    title: summary.title || title,
    description: summary.description || "",
    extract,
    url: page,
    thumbnail: thumb.source || "",
    thumbWidth: thumb.width || 0,
    thumbHeight: thumb.height || 0,
  };
}

async function wikipediaWeb(query, page) {
  const offset = (page - 1) * 15;
  const data = await fetchJson(
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(query) +
      `&srlimit=15&sroffset=${offset}&utf8=1&format=json`
  );
  return (data?.query?.search || []).map((item) => {
    const title = item.title || "";
    const slug = encodeURIComponent(title.replace(/ /g, "_"));
    return {
      title,
      url: `https://en.wikipedia.org/wiki/${slug}`,
      snippet: cleanText(item.snippet || ""),
      source: "Wikipedia",
    };
  });
}

function parseDdgHtml(raw) {
  const results = [];
  const chunks = raw.split(/<div class="result\b/);
  for (const chunk of chunks.slice(1)) {
    if (chunk.slice(0, 200).includes("result--ad")) continue;
    if (chunk.slice(0, 400).includes("y.js")) continue;
    const m = chunk.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const url = unwrapDdg(m[1]);
    const title = cleanText(m[2]);
    const sn = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = sn ? cleanText(sn[1]) : "";
    if (!url.startsWith("http") || !title) continue;
    try {
      if (new URL(url).hostname.includes("duckduckgo.com")) continue;
    } catch {
      continue;
    }
    results.push({ title, url, snippet, source: "DuckDuckGo" });
  }
  return results;
}

async function ddgWeb(query, page, news = false) {
  const fields = new URLSearchParams({ q: query, kl: "wt-wt" });
  if (page > 1) fields.set("s", String((page - 1) * 30));
  if (news) fields.set("iar", "news");
  const { ok, text } = await fetchText("https://html.duckduckgo.com/html/", {
    ua: UA_WEB,
    body: fields.toString(),
  });
  if (!ok || !text) return [];
  return parseDdgHtml(text);
}

async function commonsImages(query, page) {
  const offset = (page - 1) * 24;
  const data = await fetchJson(
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
      encodeURIComponent(query) +
      `&gsrnamespace=6&gsrlimit=24&gsroffset=${offset}` +
      "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=400&format=json"
  );
  const pages = Object.values(data?.query?.pages || {}).sort(
    (a, b) => (a.index || 0) - (b.index || 0)
  );
  const out = [];
  for (const p of pages) {
    const info = (p.imageinfo || [])[0] || {};
    const mime = String(info.mime || "").toLowerCase();
    if (!mime.startsWith("image/")) continue;
    const title = String(p.title || "").replace(/^File:/, "");
    const fileUrl = info.descriptionurl || info.url || "";
    if (!fileUrl) continue;
    out.push({
      title,
      url: fileUrl,
      thumbnail: info.thumburl || info.url || "",
      snippet: "",
      source: "Wikimedia Commons",
    });
  }
  return out;
}

async function wikinews(query, page) {
  const offset = (page - 1) * 15;
  const data = await fetchJson(
    "https://en.wikinews.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(query) +
      `&srlimit=15&sroffset=${offset}&utf8=1&format=json`
  );
  return (data?.query?.search || []).map((item) => {
    const title = item.title || "";
    const slug = encodeURIComponent(title.replace(/ /g, "_"));
    return {
      title,
      url: `https://en.wikinews.org/wiki/${slug}`,
      snippet: cleanText(item.snippet || ""),
      source: "Wikinews",
      published: "",
    };
  });
}

async function sepiasearchVideos(query, page) {
  const start = (page - 1) * 16;
  const data = await fetchJson(
    "https://sepiasearch.org/api/v1/search/videos?search=" +
      encodeURIComponent(query) +
      `&count=16&start=${start}&nsfw=false`
  );
  return (data?.data || [])
    .filter((v) => !v.nsfw)
    .map((v) => ({
      title: v.name || "Video",
      url: v.url || "",
      thumbnail: v.thumbnailUrl || "",
      duration: v.duration || 0,
      source: v.account?.host || "PeerTube",
      snippet: cleanText(v.truncatedDescription || v.description || "").slice(0, 220),
    }))
    .filter((r) => r.url);
}

async function searxngSearch(env, query, tab, page) {
  const base = String(env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!base) return null;
  const cat = { web: "general", images: "images", news: "news", videos: "videos" }[tab] || "general";
  const url =
    `${base}/search?` +
    new URLSearchParams({
      q: query,
      format: "json",
      categories: cat,
      pageno: String(page),
      language: "en",
    }).toString();
  const { ok, text } = await fetchText(url);
  if (!ok || !text) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return (data.results || [])
    .map((item) => ({
      title: cleanText(item.title || ""),
      url: stripTracking(item.url || item.iframe_src || ""),
      snippet: cleanText(item.content || ""),
      thumbnail: item.thumbnail || item.img_src || item.thumbnail_src || "",
      source: item.engine || "SearxNG",
      published: item.publishedDate || "",
      duration: 0,
    }))
    .filter((r) => r.url && r.title);
}

function mergeUnique(...lists) {
  const seen = new Set();
  const out = [];
  for (const group of lists) {
    for (const item of group || []) {
      const key = (item.url || "").replace(/\/$/, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

const LABELS = {
  searxng: "SearxNG",
  duckduckgo: "Web results",
  wikipedia: "Wikipedia",
  commons: "Wikimedia Commons",
  wikinews: "Wikinews",
  sepiasearch: "PeerTube",
  fallback: "Results",
  none: "No sources selected",
};

const ALL_ENGINES = ["duckduckgo", "wikipedia", "commons", "wikinews", "peertube", "searxng"];

function parseEngines(raw) {
  if (raw == null) return new Set(ALL_ENGINES);
  if (typeof raw === "string") raw = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(raw)) return new Set(ALL_ENGINES);
  return new Set(raw.map((s) => String(s).toLowerCase()).filter((s) => ALL_ENGINES.includes(s)));
}

async function doSearch(env, query, tab, page, engines) {
  query = String(query || "").trim().slice(0, 500);
  if (!["web", "images", "news", "videos"].includes(tab)) tab = "web";
  page = Math.max(1, Number(page) || 1);
  const want = parseEngines(engines);

  if (want.size === 0) return pack(query, tab, page, [], null, "none");

  const sx = want.has("searxng") ? await searxngSearch(env, query, tab, page) : null;

  let results = [];
  let infobox = null;
  let source = "fallback";

  if (tab === "web") {
    const [web, box, wiki] = await Promise.all([
      want.has("duckduckgo") ? ddgWeb(query, page, false) : [],
      want.has("wikipedia") ? wikipediaInfobox(query) : null,
      want.has("wikipedia") ? wikipediaWeb(query, page) : [],
    ]);
    infobox = box;
    results = mergeUnique(web, wiki, sx);
    source = sx?.length ? "searxng" : web.length ? "duckduckgo" : wiki.length ? "wikipedia" : "fallback";
  } else if (tab === "images") {
    const commons = want.has("commons") ? await commonsImages(query, page) : [];
    results = mergeUnique(commons, sx);
    source = sx?.length ? "searxng" : "commons";
  } else if (tab === "news") {
    const [news, wikiN] = await Promise.all([
      want.has("duckduckgo") ? ddgWeb(query, page, true) : [],
      want.has("wikinews") ? wikinews(query, page) : [],
    ]);
    results = mergeUnique(news, wikiN, sx);
    source = sx?.length ? "searxng" : news.length ? "duckduckgo" : wikiN.length ? "wikinews" : "fallback";
  } else {
    const videos = want.has("peertube") ? await sepiasearchVideos(query, page) : [];
    results = mergeUnique(videos, sx);
    source = sx?.length ? "searxng" : "sepiasearch";
  }

  return pack(query, tab, page, results, infobox, source);
}

function pack(query, tab, page, results, infobox, source) {
  return {
    query,
    tab,
    page,
    results,
    infobox,
    hasMore: (results || []).length >= 8,
    source,
    sourceLabel: LABELS[source] || "Results",
  };
}

function withPrivacy(resp) {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(PRIVACY)) headers.set(k, v);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=300");
  return new Response(resp.body, { status: resp.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: { Allow: "GET, POST, HEAD, OPTIONS", ...PRIVACY } });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, searxng: Boolean(env.SEARXNG_URL) });
    }

    if (url.pathname === "/api/search") {
      let q = "";
      let t = "web";
      let p = 1;
      let engines;
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        q = body.q || "";
        t = body.t || "web";
        p = body.p || 1;
        engines = body.engines;
      } else if (request.method === "GET") {
        q = url.searchParams.get("q") || "";
        t = url.searchParams.get("t") || "web";
        p = url.searchParams.get("p") || 1;
        engines = url.searchParams.get("engines");
      } else {
        return json({ error: "Method not allowed" }, 405);
      }
      if (!String(q).trim()) return json({ error: "Missing query" }, 400);
      try {
        return json(await doSearch(env, q, t, p, engines));
      } catch (err) {
        return json({ error: "Search failed", detail: String(err && err.message) }, 502);
      }
    }

    const asset = await env.ASSETS.fetch(request);
    return withPrivacy(asset);
  },
};
