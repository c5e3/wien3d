// Proxy for the Wiener Linien realtime departure monitor (OGD, CC BY 4.0), which sends no CORS headers.
// Used by the Vercel function (api/wl/monitor.js) and the Vite dev server (vite.config.js).
//
// Fair use (Wiener Linien): only query the stops you need, no more often than every 15 s. The client asks for the
// stops around the player every 30 s; identical requests within 20 s are answered from a small cache here (and
// from the CDN on Vercel).
//
// Response: { t: server time (ms), stops: [[rbl, lon, lat, [[line, 'H' | 'R', [[plannedMs, realMs], ...]], ...]], ...] }

const SOURCE = 'https://www.wienerlinien.at/ogd_realtime/monitor';
export const MAX_STOPS = 40;
const TTL = 20000;
const cache = new Map(); // key -> { t, body: Promise<string> }

/** Valid, de-duplicated, sorted RBL numbers from "1,2,3", or null. */
export function parseStops(q) {
  const ids = [...new Set(String(q || '').split(',').filter(Boolean).map(Number))];
  if (!ids.length || ids.length > MAX_STOPS || !ids.every((n) => Number.isInteger(n) && n > 0 && n < 1e6)) return null;
  return ids.sort((a, b) => a - b);
}

async function fetchMonitor(ids) {
  const r = await fetch(`${SOURCE}?${ids.map((i) => `stopId=${i}`).join('&')}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`monitor ${r.status}`);
  const j = await r.json();
  const ms = (s) => (s ? Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : null);
  const stops = (j.data?.monitors || []).map((m) => {
    const p = m.locationStop?.properties;
    const [lon, lat] = m.locationStop?.geometry?.coordinates || [];
    const lines = (m.lines || []).map((l) => [
      l.name,
      l.direction === 'R' ? 'R' : 'H',
      (l.departures?.departure || [])
        .filter((d) => d.departureTime?.timePlanned && d.departureTime?.timeReal)
        .map((d) => [ms(d.departureTime.timePlanned), ms(d.departureTime.timeReal)]),
    ]);
    return [p?.attributes?.rbl, lon, lat, lines];
  });
  return JSON.stringify({ t: ms(j.message?.serverTime) || Date.now(), stops });
}

/** Slimmed monitor data for the given stops (cached for TTL). */
export function monitor(ids) {
  const key = ids.join(',');
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.t > TTL) cache.delete(k);
  if (!cache.has(key)) {
    const body = fetchMonitor(ids);
    body.catch(() => cache.delete(key));
    cache.set(key, { t: now, body });
  }
  return cache.get(key).body;
}
