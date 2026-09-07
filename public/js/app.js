/* Wyldsearch — Copyright (C) 2026 James — GPL-3.0-or-later */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const home = $("#home");
  const results = $("#results");
  const listEl = $("#list");
  const cardEl = $("#card");
  const wikiPanel = $("#wiki-panel");
  const wxPanel = $("#wx-panel");
  const wxHome = $("#wx-home");
  const qHome = $("#q-home");
  const qResults = $("#q-results");
  const tabField = $("#tab-field");

  const TABS = ["web", "images", "news", "videos"];
  const DEFAULT_ENGINES = ["duckduckgo", "wikipedia", "commons", "wikinews", "peertube", "searxng"];
  const ALL_ENGINES = DEFAULT_ENGINES.slice();
  const STORE = "wyldsearch";

  const settingsDlg = $("#settings");
  const openSettings = $("#open-settings");

  const IDB_NAME = "wyldsearch-bg";
  let bgObjectUrl = null;

  function openBgDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("pics");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBgBlob(blob) {
    const db = await openBgDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("pics", "readwrite");
      tx.objectStore("pics").put(blob, "picture");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadBgBlob() {
    try {
      const db = await openBgDb();
      return await new Promise((resolve) => {
        const tx = db.transaction("pics", "readonly");
        const q = tx.objectStore("pics").get("picture");
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function clearBgBlob() {
    try {
      const db = await openBgDb();
      await new Promise((resolve) => {
        const tx = db.transaction("pics", "readwrite");
        tx.objectStore("pics").delete("picture");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* ignore */
    }
  }

  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1920;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > max || h > max) {
          const scale = max / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.84);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  }

  function safeBgUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      if (u.protocol !== "https:" && u.protocol !== "http:") return "";
      return u.href;
    } catch {
      return "";
    }
  }

  async function applyBackground() {
    if (bgObjectUrl) {
      URL.revokeObjectURL(bgObjectUrl);
      bgObjectUrl = null;
    }
    const dim = Math.min(85, Math.max(20, Number(settings.bgDim) || 58)) / 100;
    document.documentElement.style.setProperty("--bg-dim", String(dim));
    const preview = $("#bg-preview");
    let src = "";
    const blob = await loadBgBlob();
    if (blob) {
      bgObjectUrl = URL.createObjectURL(blob);
      src = bgObjectUrl;
    } else {
      src = safeBgUrl(settings.bgUrl);
    }
    if (src) {
      document.documentElement.classList.add("has-bg");
      document.documentElement.style.setProperty("--bg-picture", `url("${src.replace(/"/g, "%22")}")`);
      if (preview) {
        preview.src = src;
        preview.classList.add("is-on");
      }
    } else {
      document.documentElement.classList.remove("has-bg");
      document.documentElement.style.removeProperty("--bg-picture");
      if (preview) {
        preview.removeAttribute("src");
        preview.classList.remove("is-on");
      }
    }
  }

  function loadSettings() {
    const fallback = {
      theme: "dark",
      engines: DEFAULT_ENGINES.slice(),
      bgUrl: "",
      bgDim: 58,
      weatherOn: true,
      weatherUnits: "imperial",
      weatherPlace: null,
    };
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return fallback;
      const s = JSON.parse(raw);
      const theme = ["dark", "light", "system"].includes(s.theme) ? s.theme : "dark";
      let engines = Array.isArray(s.engines) ? s.engines.filter((e) => ALL_ENGINES.includes(e)) : DEFAULT_ENGINES.slice();
      const bgUrl = safeBgUrl(s.bgUrl);
      const bgDim = Math.min(85, Math.max(20, Number(s.bgDim) || 58));
      const weatherOn = s.weatherOn !== false;
      const weatherUnits = s.weatherUnits === "metric" ? "metric" : "imperial";
      let weatherPlace = null;
      if (s.weatherPlace && typeof s.weatherPlace === "object" && s.weatherPlace.lat != null) {
        weatherPlace = {
          lat: Number(s.weatherPlace.lat),
          lon: Number(s.weatherPlace.lon),
          label: String(s.weatherPlace.label || "Saved place"),
        };
      }
      return { theme, engines, bgUrl, bgDim, weatherOn, weatherUnits, weatherPlace };
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
    const urlEl = $("#bg-url");
    const dimEl = $("#bg-dim");
    const dimLabel = $("#bg-dim-label");
    if (urlEl) urlEl.value = s.bgUrl || "";
    if (dimEl) dimEl.value = String(s.bgDim || 58);
    if (dimLabel) dimLabel.textContent = `${s.bgDim || 58}%`;
    const wxOn = $("#weather-on");
    if (wxOn) wxOn.checked = s.weatherOn !== false;
    const city = $("#wx-city");
    if (city) city.value = (s.weatherPlace && s.weatherPlace.label) || "";
    $$("input[name='wx-units']").forEach((el) => {
      el.checked = el.value === (s.weatherUnits || "imperial");
    });
  }

  function readSettingsForm() {
    const theme = $("input[name='theme']:checked")?.value || "dark";
    const engines = $$("input[name='engine']:checked").map((el) => el.value);
    const bgUrl = safeBgUrl($("#bg-url")?.value || "");
    const bgDim = Math.min(85, Math.max(20, Number($("#bg-dim")?.value) || 58));
    const weatherOn = !!$("#weather-on")?.checked;
    const weatherUnits = $("input[name='wx-units']:checked")?.value === "metric" ? "metric" : "imperial";
    const weatherPlace = settings.weatherPlace || null;
    return { theme, engines, bgUrl, bgDim, weatherOn, weatherUnits, weatherPlace };
  }

  let settings = loadSettings();
  applyTheme(settings.theme);
  syncSettingsForm(settings);
  applyBackground();

  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (settings.theme === "system") applyTheme("system");
  });

  openSettings?.addEventListener("click", async () => {
    syncSettingsForm(settings);
    try {
      const h = await fetch("/api/health", { credentials: "omit", cache: "no-store" }).then((r) => r.json());
      const setHint = (id, on, onText, offText) => {
        const el = $(id);
        if (el) el.textContent = on ? onText : offText;
      };
      setHint(
        "#searxng-hint",
        h.searxng,
        "All tabs, using your connected instance",
        "Connect a SearxNG instance on the server to use this"
      );
    } catch {
      /* ignore */
    }
    settingsDlg?.showModal();
  });

  settingsDlg?.addEventListener("close", async () => {
    settings = readSettingsForm();
    const typed = ($("#wx-city")?.value || "").trim();
    const had = (settings.weatherPlace && settings.weatherPlace.label) || "";
    if (typed && typed !== had && window.WyldWx) {
      try {
        const place = await window.WyldWx.geocode(typed);
        if (place) settings.weatherPlace = place;
      } catch {
        /* keep previous place */
      }
    }
    saveSettings(settings);
    applyTheme(settings.theme);
    applyBackground();
    refreshHomeWx();
    const st = params();
    if (st.q) runSearch(st, { push: false });
  });

  $("#bg-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const blob = await shrinkImage(file);
      await saveBgBlob(blob);
      settings.bgUrl = "";
      const urlEl = $("#bg-url");
      if (urlEl) urlEl.value = "";
      saveSettings(settings);
      await applyBackground();
    } catch {
      /* skip bad file */
    }
  });

  $("#bg-dim")?.addEventListener("input", (ev) => {
    const v = Math.min(85, Math.max(20, Number(ev.target.value) || 58));
    const label = $("#bg-dim-label");
    if (label) label.textContent = `${v}%`;
    document.documentElement.style.setProperty("--bg-dim", String(v / 100));
  });

  async function lookupCity() {
    const Wx = window.WyldWx;
    const city = ($("#wx-city")?.value || "").trim();
    const status = $("#wx-status");
    if (!Wx || city.length < 2) return;
    if (status) status.textContent = "Looking up place…";
    try {
      const place = await Wx.geocode(city);
      if (!place) {
        if (status) status.textContent = "Could not find that place.";
        return;
      }
      settings.weatherPlace = place;
      if ($("#wx-city")) $("#wx-city").value = place.label;
      if (status) status.textContent = "Saved: " + place.label;
      saveSettings(settings);
      refreshHomeWx();
    } catch {
      if (status) status.textContent = "Place lookup failed.";
    }
  }

  $("#wx-city")?.addEventListener("change", lookupCity);
  $("#wx-city")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      lookupCity();
    }
  });

  $("#wx-geo")?.addEventListener("click", async () => {
    const Wx = window.WyldWx;
    const status = $("#wx-status");
    if (!Wx) return;
    if (status) status.textContent = "Asking for location…";
    try {
      const pos = await Wx.gps();
      const label = await Wx.reverseLabel(pos.lat, pos.lon);
      settings.weatherPlace = { lat: pos.lat, lon: pos.lon, label };
      settings.weatherOn = true;
      const on = $("#weather-on");
      if (on) on.checked = true;
      if ($("#wx-city")) $("#wx-city").value = label;
      if (status) status.textContent = "Saved: " + label;
      saveSettings(settings);
      refreshHomeWx();
    } catch {
      if (status) status.textContent = "Location was denied or unavailable.";
    }
  });

  $("#weather-on")?.addEventListener("change", () => {
    settings.weatherOn = !!$("#weather-on").checked;
    saveSettings(settings);
    refreshHomeWx();
  });

  $$("input[name='wx-units']").forEach((el) => {
    el.addEventListener("change", () => {
      settings.weatherUnits = el.value === "metric" ? "metric" : "imperial";
      saveSettings(settings);
      refreshHomeWx();
    });
  });

  function deg(n) {
    return n == null || Number.isNaN(Number(n)) ? "—" : Math.round(Number(n)) + "°";
  }

  function weekday(iso) {
    try {
      return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
    } catch {
      return "";
    }
  }

  function syncAside() {
    if (!cardEl) return;
    const wxOn = wxPanel && !wxPanel.hidden && wxPanel.innerHTML;
    const wikiOn = wikiPanel && wikiPanel.innerHTML.trim();
    cardEl.hidden = !wxOn && !wikiOn;
  }

  async function refreshHomeWx() {
    if (!wxHome) return;
    if (!settings.weatherOn) {
      wxHome.hidden = true;
      wxHome.classList.add("hidden");
      wxHome.innerHTML = "";
      return;
    }
    wxHome.hidden = false;
    wxHome.classList.remove("hidden");
    const Wx = window.WyldWx;
    const place = settings.weatherPlace;
    if (!place) {
      wxHome.innerHTML = `<button type="button" class="wx-cta" id="wx-home-setup">Add a place for GeauxWeather</button>`;
      $("#wx-home-setup")?.addEventListener("click", () => {
        settingsDlg?.showModal();
        $("#wx-city")?.focus();
      });
      return;
    }
    try {
      const wx = await Wx.loadPlace(place, settings.weatherUnits);
      if (!wx) throw new Error("empty");
      wxHome.innerHTML = `
        <a href="${esc(wx.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer">
          <span class="wx-icon" aria-hidden="true">${esc(wx.icon)}</span>
          <span class="wx-temp">${esc(deg(wx.temp))}</span>
          <span class="wx-meta">
            <span class="wx-cond">${esc(wx.cond)}</span>
            <span class="wx-place">${esc(wx.place.label)}</span>
          </span>
          <span class="wx-hl">H ${esc(deg(wx.high))} · L ${esc(deg(wx.low))}</span>
        </a>`;
    } catch {
      wxHome.innerHTML = `<p class="wx-cta">Weather didn’t load. Try again from Settings.</p>`;
    }
  }

  function renderWxPanel(wx) {
    if (!wxPanel) return;
    if (!wx) {
      wxPanel.hidden = true;
      wxPanel.innerHTML = "";
      syncAside();
      return;
    }
    const days = (wx.days || [])
      .map((d, i) => {
        const cond = window.WyldWx.condition(d.code);
        const label = i === 0 ? "Today" : weekday(d.date);
        return `<div class="wx-day">${esc(label)}<br>${esc(cond.icon)}<strong>${esc(deg(d.max))}</strong>${esc(deg(d.min))}</div>`;
      })
      .join("");
    wxPanel.innerHTML = `
      <article class="wx-card">
        <div class="wx-card-body">
          <p class="wiki-kicker">GeauxWeather</p>
          <h2>${esc(wx.place.label)}</h2>
          <div class="wx-now">
            <span class="wx-icon" aria-hidden="true">${esc(wx.icon)}</span>
            <span class="wx-temp">${esc(deg(wx.temp))}</span>
            <span class="wx-cond">${esc(wx.cond)}</span>
          </div>
          <p class="wiki-desc">H ${esc(deg(wx.high))} · L ${esc(deg(wx.low))}${wx.feels != null ? " · Feels " + esc(deg(wx.feels)) : ""}</p>
          <div class="wx-days">${days}</div>
          <a class="wiki-link" href="${esc(wx.url)}" rel="noopener noreferrer" referrerpolicy="no-referrer">Open GeauxWeather</a>
        </div>
      </article>`;
    wxPanel.hidden = false;
    syncAside();
  }

  async function maybeWeatherAnswer(q) {
    const Wx = window.WyldWx;
    if (!Wx) return;
    const parsed = Wx.parseQuery(q);
    if (!parsed) {
      renderWxPanel(null);
      return;
    }
    let place = settings.weatherPlace;
    if (parsed.place) {
      try {
        place = await Wx.geocode(parsed.place);
      } catch {
        place = null;
      }
    }
    if (!place) {
      renderWxPanel(null);
      return;
    }
    try {
      const wx = await Wx.loadPlace(place, settings.weatherUnits);
      renderWxPanel(wx);
    } catch {
      renderWxPanel(null);
    }
  }

  $("#bg-clear")?.addEventListener("click", async () => {
    settings.bgUrl = "";
    const urlEl = $("#bg-url");
    if (urlEl) urlEl.value = "";
    await clearBgBlob();
    saveSettings(settings);
    await applyBackground();
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
    if (wikiPanel) wikiPanel.innerHTML = "";
    if (wxPanel) {
      wxPanel.hidden = true;
      wxPanel.innerHTML = "";
    }
    if (cardEl) cardEl.hidden = true;
  }

  function emptyMsg(data, kind) {
    if (data.source === "none" || !(settings.engines || []).length) {
      return `<p class="empty">No search sources are turned on. Open Settings and check at least one.</p>`;
    }
    return `<p class="empty">No ${kind} for “${esc(data.query)}”.</p>`;
  }

  function renderCard(info) {
    if (!wikiPanel) return;
    if (!info || !info.title || !info.extract) {
      wikiPanel.innerHTML = "";
      syncAside();
      return;
    }
    const img = info.thumbnail
      ? `<img src="${esc(info.thumbnail)}" alt="" width="${esc(info.thumbWidth || 320)}" height="${esc(info.thumbHeight || 180)}" referrerpolicy="no-referrer">`
      : "";
    wikiPanel.innerHTML = `
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
    syncAside();
  }

  function renderWeb(data) {
    const items = data.results || [];
    if (!items.length) {
      listEl.innerHTML = emptyMsg(data, "web results");
      return;
    }
    const rows = items.map((r) => `
      <article class="result">
        <span class="result-url">${esc(displayUrl(r.url))}${r.source ? " · " + esc(r.source) : ""}</span>
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
      refreshHomeWx();
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
      if (t === "web") {
        renderCard(data.infobox);
        maybeWeatherAnswer(q);
      } else {
        if (wikiPanel) wikiPanel.innerHTML = "";
        renderWxPanel(null);
        if (cardEl) cardEl.hidden = true;
      }
    } catch (err) {
      listEl.innerHTML = `<p class="status error">${esc(err.message || "Search didn’t come back.")} Try again.</p>`;
      if (wikiPanel) wikiPanel.innerHTML = "";
      renderWxPanel(null);
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
    refreshHomeWx();
  }
})();
