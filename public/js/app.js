/* Wyldsearch — Copyright (C) 2026 James — GPL-3.0-or-later */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const home = $("#home");
  const results = $("#results");
  const listEl = $("#list");
  const cardEl = $("#card");
  const qHome = $("#q-home");
  const qResults = $("#q-results");
  const tabField = $("#tab-field");

  const TABS = ["web", "images", "news", "videos"];
  const ALL_ENGINES = ["duckduckgo", "wikipedia", "commons", "wikinews", "peertube", "searxng"];
  const STORE = "wyldsearch";

  const settingsDlg = $("#settings");
  const openSettings = $("#open-settings");

  function loadSettings() {
    const fallback = { theme: "dark", engines: ALL_ENGINES.slice() };
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return fallback;
      const s = JSON.parse(raw);
      const theme = ["dark", "light", "system"].includes(s.theme) ? s.theme : "dark";
      let engines = Array.isArray(s.engines) ? s.engines.filter((e) => ALL_ENGINES.includes(e)) : ALL_ENGINES.slice();
      return { theme, engines };
    } catch {
      return fallback;
    }
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  }

  function resolvedTheme(theme) {
    if (theme === "system") {
      return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return theme === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    const t = resolvedTheme(theme);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f3f5f1" : "#0a0c0b");
  }

  function syncSettingsForm(s) {
    $$("input[name='theme']").forEach((el) => {
      el.checked = el.value === s.theme;
    });
    $$("input[name='engine']").forEach((el) => {
      el.checked = s.engines.includes(el.value);
    });
  }

  function readSettingsForm() {
    const theme = $("input[name='theme']:checked")?.value || "dark";
    const engines = $$("input[name='engine']:checked").map((el) => el.value);
    return { theme, engines };
  }

  let settings = loadSettings();
  applyTheme(settings.theme);
  syncSettingsForm(settings);

  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (settings.theme === "system") applyTheme("system");
  });

  openSettings?.addEventListener("click", async () => {
    syncSettingsForm(settings);
    try {
      const h = await fetch("/api/health", { credentials: "omit", cache: "no-store" }).then((r) => r.json());
      const hint = $("#searxng-hint");
      if (hint) hint.textContent = h.searxng
        ? "All tabs, using your connected instance"
        : "All tabs — connect a SearxNG instance on the server to use this";
    } catch {
      /* ignore */
    }
    settingsDlg?.showModal();
  });

  settingsDlg?.addEventListener("close", () => {
    settings = readSettingsForm();
    saveSettings(settings);
    applyTheme(settings.theme);
    const st = params();
    if (st.q) runSearch(st, { push: false });
  });

  $$("input[name='theme']").forEach((el) => {
    el.addEventListener("change", () => {
      applyTheme(el.value);
    });
  });

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function displayUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      let path = u.pathname + (u.search || "");
      if (path.length > 48) path = path.slice(0, 46) + "…";
      return host + (path === "/" ? "" : path);
    } catch {
      return url;
    }
  }

  function fmtDuration(sec) {
    const n = Number(sec) || 0;
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function params() {
    const u = new URL(location.href);
    const q = (u.searchParams.get("q") || "").trim();
    let t = (u.searchParams.get("t") || "web").toLowerCase();
    if (!TABS.includes(t)) t = "web";
    const p = Math.max(1, parseInt(u.searchParams.get("p") || "1", 10) || 1);
    return { q, t, p };
  }

  function setUrl({ q, t, p }, replace = false) {
    const u = new URL(location.href);
    u.search = "";
    if (q) u.searchParams.set("q", q);
    if (t && t !== "web") u.searchParams.set("t", t);
    if (p && p > 1) u.searchParams.set("p", String(p));
    const next = u.pathname + u.search;
    if (replace) history.replaceState({ q, t, p }, "", next);
    else history.pushState({ q, t, p }, "", next);
  }

  function setTabs(t) {
    $$(".tab").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.dataset.tab === t ? "true" : "false");
    });
    if (tabField) tabField.value = t;
  }

  function showHome() {
    home.classList.remove("hidden");
    home.setAttribute("aria-hidden", "false");
    results.classList.add("hidden");
    results.setAttribute("aria-hidden", "true");
    document.title = "Wyldsearch";
  }

  function showResults() {
    home.classList.add("hidden");
    home.setAttribute("aria-hidden", "true");
    results.classList.remove("hidden");
    results.setAttribute("aria-hidden", "false");
  }

  function wikiTitleUrl(title, host) {
    const slug = encodeURIComponent(String(title || "").replace(/ /g, "_"));
    return `https://${host}/wiki/${slug}`;
  }

  async function wikiSearch(host, query, page) {
    const offset = (page - 1) * 15;
    const url =
      `https://${host}/w/api.php?action=query&list=search&srsearch=` +
      `${encodeURIComponent(query)}&srlimit=15&sroffset=${offset}&utf8=1&format=json&origin=*`;
    const data = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => r.json());
    return (data?.query?.search || []).map((item) => ({
      title: item.title,
      url: wikiTitleUrl(item.title, host),
      snippet: String(item.snippet || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      source: host.includes("wikinews") ? "Wikinews" : "Wikipedia",
    }));
  }

  async function wikiBox(query) {
    const hits = await wikiSearch("en.wikipedia.org", query, 1);
    if (!hits.length) return null;
    const slug = encodeURIComponent(hits[0].title.replace(/ /g, "_"));
    const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).then((r) => r.json());
    if (!summary || summary.type === "disambiguation" || !summary.extract) return null;
    return {
      title: summary.title,
      description: summary.description || "",
      extract: summary.extract,
      url: summary.content_urls?.desktop?.page || hits[0].url,
      thumbnail: summary.thumbnail?.source || "",
      thumbWidth: summary.thumbnail?.width || 0,
      thumbHeight: summary.thumbnail?.height || 0,
    };
  }

  async function commonsImages(query, page) {
    const offset = (page - 1) * 24;
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
      `${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=24&gsroffset=${offset}` +
      "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=400&format=json&origin=*";
    const data = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => r.json());
    return Object.values(data?.query?.pages || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => {
        const info = (p.imageinfo || [])[0] || {};
        if (!String(info.mime || "").startsWith("image/")) return null;
        return {
          title: String(p.title || "").replace(/^File:/, ""),
          url: info.descriptionurl || info.url || "",
          thumbnail: info.thumburl || info.url || "",
          snippet: "",
          source: "Wikimedia Commons",
        };
      })
      .filter((r) => r && r.url);
  }

  async function sepiasearch(query, page) {
    const start = (page - 1) * 16;
    const url =
      "https://sepiasearch.org/api/v1/search/videos?search=" +
      `${encodeURIComponent(query)}&count=16&start=${start}&nsfw=false`;
    const data = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => r.json());
    return (data?.data || [])
      .filter((v) => !v.nsfw)
      .map((v) => ({
        title: v.name || "Video",
        url: v.url || "",
        thumbnail: v.thumbnailUrl || "",
        duration: v.duration || 0,
        source: v.account?.host || "PeerTube",
        snippet: "",
      }))
      .filter((r) => r.url);
  }

  async function directSearch(q, t, p, engines) {
    const on = (id) => !engines || engines.includes(id);
    if (t === "images") {
      const results = on("commons") ? await commonsImages(q, p) : [];
      return { query: q, results, infobox: null, hasMore: results.length >= 8, sourceLabel: "Wikimedia Commons", page: p };
    }
    if (t === "news") {
      const results = on("wikinews") ? await wikiSearch("en.wikinews.org", q, p) : [];
      return { query: q, results, infobox: null, hasMore: results.length >= 8, sourceLabel: "Wikinews", page: p };
    }
    if (t === "videos") {
      const results = on("peertube") ? await sepiasearch(q, p) : [];
      return { query: q, results, infobox: null, hasMore: results.length >= 8, sourceLabel: "PeerTube", page: p };
    }
    const tasks = [];
    if (on("wikipedia")) tasks.push(wikiSearch("en.wikipedia.org", q, p), wikiBox(q));
    else tasks.push(Promise.resolve([]), Promise.resolve(null));
    const [results, infobox] = await Promise.all(tasks);
    return { query: q, results, infobox, hasMore: results.length >= 8, sourceLabel: "Wikipedia", page: p };
  }

  async function apiSearch(q, t, p) {
    const engines = settings.engines;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ q, t, p, engines }),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      if (res.ok) return await res.json();
    } catch {
      /* static host — fall through */
    }
    return directSearch(q, t, p, engines);
  }

  function skeleton(tab) {
    if (tab === "images" || tab === "videos") {
      listEl.innerHTML = `<div class="skeleton image-grid">${"<div class='result'></div>".repeat(8)}</div>`;
    } else {
      listEl.innerHTML = `<p class="status">Searching privately…</p><div class="skeleton">${"<div class='result'></div>".repeat(6)}</div>`;
    }
    cardEl.hidden = true;
    cardEl.innerHTML = "";
  }

  function emptyMsg(data, kind) {
    if (data.source === "none" || !(settings.engines || []).length) {
      return `<p class="empty">No search sources are turned on. Open Settings and check at least one.</p>`;
    }
    return `<p class="empty">No ${kind} for “${esc(data.query)}”.</p>`;
  }

  function renderCard(info) {
    if (!info || !info.title || !info.extract) {
      cardEl.hidden = true;
      cardEl.innerHTML = "";
      return;
    }
    const img = info.thumbnail
      ? `<img src="${esc(info.thumbnail)}" alt="" width="${esc(info.thumbWidth || 320)}" height="${esc(info.thumbHeight || 180)}" referrerpolicy="no-referrer">`
      : "";
    cardEl.innerHTML = `
      <article class="wiki-card">
        ${img}
        <div class="wiki-card-body">
          <p class="wiki-kicker">Wikipedia</p>
          <h2>${esc(info.title)}</h2>
          ${info.description ? `<p class="wiki-desc">${esc(info.description)}</p>` : ""}
          <p class="wiki-extract">${esc(info.extract)}</p>
          ${info.url ? `<a class="wiki-link" href="${esc(info.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">Read on Wikipedia</a>` : ""}
        </div>
      </article>`;
    cardEl.hidden = false;
  }

  function renderWeb(data) {
    const items = data.results || [];
    if (!items.length) {
      listEl.innerHTML = emptyMsg(data, "web results");
      return;
    }
    const rows = items.map((r) => `
      <article class="result">
        <span class="result-url">${esc(displayUrl(r.url))}</span>
        <h3 class="result-title"><a href="${esc(r.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">${esc(r.title)}</a></h3>
        <p class="result-snippet">${esc(r.snippet || "")}</p>
      </article>`).join("");
    listEl.innerHTML = `<p class="status">${esc(data.sourceLabel || "Results")} for “${esc(data.query)}”</p>${rows}${pager(data)}`;
  }

  function renderNews(data) {
    const items = data.results || [];
    if (!items.length) {
      listEl.innerHTML = emptyMsg(data, "news results");
      return;
    }
    const rows = items.map((r) => `
      <article class="news-item">
        <div class="news-meta">${esc(r.source || displayUrl(r.url))}${r.published ? " · " + esc(r.published) : ""}</div>
        <h3 class="result-title"><a href="${esc(r.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">${esc(r.title)}</a></h3>
        <p class="result-snippet">${esc(r.snippet || "")}</p>
      </article>`).join("");
    listEl.innerHTML = `<p class="status">News for “${esc(data.query)}”</p>${rows}${pager(data)}`;
  }

  function renderImages(data) {
    const items = data.results || [];
    if (!items.length) {
      listEl.innerHTML = emptyMsg(data, "images");
      return;
    }
    const cells = items.map((r) => `
      <a href="${esc(r.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">
        <img src="${esc(r.thumbnail || r.url)}" alt="${esc(r.title || "")}" loading="lazy" referrerpolicy="no-referrer">
        <span class="image-cap">${esc(r.title || "")}</span>
      </a>`).join("");
    listEl.innerHTML = `<p class="status">Images for “${esc(data.query)}”</p><div class="image-grid">${cells}</div>${pager(data)}`;
  }

  function renderVideos(data) {
    const items = data.results || [];
    if (!items.length) {
      listEl.innerHTML = emptyMsg(data, "videos");
      return;
    }
    const cells = items.map((r) => `
      <a class="video-card" href="${esc(r.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer" target="_blank">
        <div class="video-thumb">
          ${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
          ${r.duration ? `<span class="duration">${esc(fmtDuration(r.duration))}</span>` : ""}
        </div>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.source || displayUrl(r.url))}</p>
      </a>`).join("");
    listEl.innerHTML = `<p class="status">Videos for “${esc(data.query)}”</p><div class="video-grid">${cells}</div>${pager(data)}`;
  }

  function pager(data) {
    if (!data.hasMore) return "";
    const next = Number(data.page || 1) + 1;
    return `<p class="more"><button type="button" data-next="${next}">More results</button></p>`;
  }

  async function runSearch({ q, t, p }, { push = false } = {}) {
    if (!q) {
      showHome();
      setUrl({ q: "", t: "web", p: 1 }, true);
      qHome?.focus();
      return;
    }

    showResults();
    setTabs(t);
    qHome.value = q;
    qResults.value = q;
    document.title = `${q} · Wyldsearch`;
    if (push) setUrl({ q, t, p });
    else setUrl({ q, t, p }, true);

    skeleton(t);
    try {
      const data = await apiSearch(q, t, p);
      data.query = data.query || q;
      data.page = p;
      if (t === "images") renderImages(data);
      else if (t === "news") renderNews(data);
      else if (t === "videos") renderVideos(data);
      else renderWeb(data);
      if (t === "web") renderCard(data.infobox);
      else {
        cardEl.hidden = true;
        cardEl.innerHTML = "";
      }
    } catch (err) {
      listEl.innerHTML = `<p class="status error">${esc(err.message || "Search didn’t come back.")} Try again.</p>`;
      cardEl.hidden = true;
    }
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const q = (form.querySelector('input[name="q"]')?.value || "").trim();
    const t = params().t || "web";
    runSearch({ q, t, p: 1 }, { push: true });
  }

  $$(".search-form").forEach((form) => form.addEventListener("submit", onSubmit));

  $$(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { q } = params();
      const t = btn.dataset.tab;
      if (!q) return;
      runSearch({ q, t, p: 1 }, { push: true });
    });
  });

  listEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-next]");
    if (!btn) return;
    const { q, t } = params();
    const p = parseInt(btn.dataset.next, 10) || 2;
    runSearch({ q, t, p }, { push: true });
  });

  window.addEventListener("popstate", () => {
    const st = params();
    runSearch(st, { push: false });
  });

  const initial = params();
  if (initial.q) runSearch(initial, { push: false });
  else {
    showHome();
    qHome?.focus();
  }
})();
