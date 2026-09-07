/* Wyldsearch — Copyright (C) 2026 James — GPL-3.0-or-later
   Compact GeauxWeather helper: Open-Meteo + Open-Meteo geocoding. */
(function (global) {
  const FORECAST = "https://api.open-meteo.com/v1/forecast";
  const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
  const GW = "https://geauxweather.com/";

  const CODES = {
    0: { text: "Clear", icon: "☀️" },
    1: { text: "Mainly clear", icon: "🌤" },
    2: { text: "Partly cloudy", icon: "⛅" },
    3: { text: "Overcast", icon: "☁️" },
    45: { text: "Fog", icon: "🌫" },
    48: { text: "Rime fog", icon: "🌫" },
    51: { text: "Light drizzle", icon: "🌦" },
    53: { text: "Drizzle", icon: "🌦" },
    55: { text: "Heavy drizzle", icon: "🌧" },
    61: { text: "Light rain", icon: "🌧" },
    63: { text: "Rain", icon: "🌧" },
    65: { text: "Heavy rain", icon: "🌧" },
    71: { text: "Light snow", icon: "🌨" },
    73: { text: "Snow", icon: "❄️" },
    75: { text: "Heavy snow", icon: "❄️" },
    80: { text: "Rain showers", icon: "🌦" },
    81: { text: "Showers", icon: "🌧" },
    82: { text: "Heavy showers", icon: "🌧" },
    95: { text: "Thunderstorm", icon: "⛈" },
    96: { text: "T-storm + hail", icon: "⛈" },
    99: { text: "T-storm + heavy hail", icon: "⛈" },
  };

  function condition(code) {
    return CODES[Number(code)] || { text: "—", icon: "☁️" };
  }

  function gwUrl(place) {
    if (place && place.lat != null && place.lon != null) {
      return GW + "#/" + Number(place.lat).toFixed(4) + "," + Number(place.lon).toFixed(4);
    }
    return GW;
  }

  async function geocode(name) {
    const q = String(name || "").trim();
    if (q.length < 2) return null;
    const url =
      GEOCODE +
      "?name=" +
      encodeURIComponent(q) +
      "&count=1&language=en&format=json";
    const data = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => r.json());
    const hit = (data && data.results && data.results[0]) || null;
    if (!hit) return null;
    const bits = [hit.name, hit.admin1, hit.country_code].filter(Boolean);
    return { lat: hit.latitude, lon: hit.longitude, label: bits.join(", ") };
  }

  async function reverseLabel(lat, lon) {
    try {
      const url =
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=" +
        encodeURIComponent(lat) +
        "&lon=" +
        encodeURIComponent(lon);
      const data = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => r.json());
      const a = data.address || {};
      const label = [a.city || a.town || a.village || a.county, a.state, a.country_code && String(a.country_code).toUpperCase()]
        .filter(Boolean)
        .join(", ");
      return label || "Current location";
    } catch {
      return "Current location";
    }
  }

  function gps() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("no-geo"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
      );
    });
  }

  async function forecast(lat, lon, units) {
    const imperial = units !== "metric";
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,weather_code,apparent_temperature,wind_speed_10m,relative_humidity_2m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      temperature_unit: imperial ? "fahrenheit" : "celsius",
      wind_speed_unit: imperial ? "mph" : "kmh",
      timezone: "auto",
      forecast_days: "6",
    });
    const res = await fetch(FORECAST + "?" + params, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error("weather");
    return res.json();
  }

  function parseQuery(q) {
    const t = String(q || "").trim();
    if (!t) return null;
    const inFor = t.match(/^(?:(?:what(?:'|’)?s|how(?:'|’)?s)\s+(?:the\s+)?)?(?:weather|forecast|radar)\b\s+(?:in|for|at|near)\s+(.+)$/i);
    if (inFor) return { place: inFor[1].trim() };
    const lead = t.match(/^(?:(?:what(?:'|’)?s|how(?:'|’)?s)\s+(?:the\s+)?)?(?:weather|forecast|radar)\b\s*(.*)$/i);
    if (lead) return { place: (lead[1] || "").trim() };
    const trail = t.match(/^(.+?)\s+(?:weather|forecast|radar)$/i);
    if (trail) return { place: trail[1].trim() };
    return null;
  }

  function pack(place, data, units) {
    const cur = data.current || {};
    const daily = data.daily || {};
    const cond = condition(cur.weather_code);
    const days = [];
    const names = daily.time || [];
    for (let i = 0; i < Math.min(5, names.length); i++) {
      days.push({
        date: names[i],
        max: daily.temperature_2m_max && daily.temperature_2m_max[i],
        min: daily.temperature_2m_min && daily.temperature_2m_min[i],
        code: daily.weather_code && daily.weather_code[i],
        pop: daily.precipitation_probability_max && daily.precipitation_probability_max[i],
      });
    }
    return {
      place,
      units: units === "metric" ? "metric" : "imperial",
      temp: cur.temperature_2m,
      feels: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      cond: cond.text,
      icon: cond.icon,
      high: days[0] && days[0].max,
      low: days[0] && days[0].min,
      days,
      url: gwUrl(place),
    };
  }

  async function loadPlace(place, units) {
    if (!place || place.lat == null || place.lon == null) return null;
    const data = await forecast(place.lat, place.lon, units);
    return pack(place, data, units);
  }

  global.WyldWx = {
    geocode,
    reverseLabel,
    gps,
    loadPlace,
    parseQuery,
    condition,
    gwUrl,
  };
})(window);
