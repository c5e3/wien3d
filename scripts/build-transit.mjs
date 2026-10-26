// Preprocess the Wiener Linien timetable into public/data/transit.json for the moving vehicles (src/transit.js).
//
// Sources:
//  - Wiener Linien GTFS (CC BY 4.0): lines, stops, shapes and every trip of the timetable period (~750 MB of
//    stop_times), boiled down to stop patterns, shared time profiles and start times
//  - Wiener Linien OGD "haltepunkte" (CC BY 4.0): RBL numbers, the stop ids of the realtime departure monitor
//  - OpenStreetMap via Overpass (ODbL): which stretches of U-Bahn and tram run in tunnels (hidden in the 3D map)
//    or on bridges and viaducts
//  - public/data/structures.json (scripts/build-structures.mjs): bridge footprints, for buses and trams
//  - Stadt Wien DOM 5 m (surface model, CC BY 4.0): deck heights along bridge and viaduct stretches
//
// Usage: node --max-old-space-size=8000 scripts/build-transit.mjs
//   (downloads ~250 MB into .cache, shares the DOM with build-structures; rerun after a timetable change)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Unzip, UnzipInflate } from 'fflate';
import proj4 from 'proj4';
import { fromFile } from 'geotiff';

const CACHE = '.cache/transit';
const OUT = 'public/data/transit.json';
const GTFS_URL = 'https://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip';
const RBL_URL = 'https://www.wienerlinien.at/ogd_realtime/doku/ogd/wienerlinien-ogd-haltepunkte.csv';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OSM_QUERY = '[out:json][timeout:300][bbox:47.98,16.18,48.33,16.58];way["railway"~"^(subway|tram|light_rail)$"];out tags geom;';
const DOM_URL = 'https://www.wien.gv.at/data/inspire/AT_0052_R_13_DOM5_2023_COG.tif';
const WIENER_NULL = 156.68; // the DOM is relative to Vienna's local datum, terrain is above Adriatic
const GTFS_FILES = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'shapes.txt', 'calendar.txt', 'calendar_dates.txt'];

// modes, also used by the client
const TRAM = 0, METRO = 1, BUS = 2, NIGHT = 3, WLB = 4;

const SIMPLIFY_M = 0.8; // shape simplification tolerance
const SAMPLE_M = 4; // spacing for tunnel / bridge detection
const OSM_MATCH_M = 12; // max distance from a shape to an OSM track
const MIN_RUN_M = 30; // shorter tunnel / surface stretches are merged into their neighbours
const DECK_STEP_M = 8; // spacing of the deck height profile on bridge stretches

fs.mkdirSync(CACHE, { recursive: true });

async function download(url, file, dir = CACHE) {
  const p = path.join(dir, file);
  if (fs.existsSync(p)) return p;
  console.log('downloading', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return p;
}

/** Unzip the GTFS files to disk (stop_times is too big for one string). */
async function extractGtfs(zip) {
  const dir = path.join(CACHE, 'gtfs');
  if (GTFS_FILES.every((f) => fs.existsSync(path.join(dir, f)))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  console.log('extracting', zip);
  await new Promise((resolve, reject) => {
    const open = new Set();
    let ended = false;
    const done = () => ended && !open.size && resolve();
    const uz = new Unzip((file) => {
      if (!GTFS_FILES.includes(file.name)) return;
      const out = fs.openSync(path.join(dir, file.name), 'w');
      open.add(file.name);
      file.ondata = (err, chunk, final) => {
        if (err) return reject(err);
        fs.writeSync(out, chunk);
        if (final) {
          fs.closeSync(out);
          open.delete(file.name);
          done();
        }
      };
      file.start();
    });
    uz.register(UnzipInflate);
    const rs = fs.createReadStream(zip);
    rs.on('data', (c) => uz.push(c));
    rs.on('end', () => {
      uz.push(new Uint8Array(0), true);
      ended = true;
      done();
    });
    rs.on('error', reject);
  });
  return dir;
}

function parseCsvLine(line, sep = ',') {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let s = '', j = i + 1;
      for (;;) {
        const q = line.indexOf('"', j);
        if (q < 0) { s += line.slice(j); j = line.length; break; }
        s += line.slice(j, q);
        if (line[q + 1] === '"') { s += '"'; j = q + 2; } else { j = q + 1; break; }
      }
      out.push(s);
      i = j + 1;
    } else {
      const c = line.indexOf(sep, i);
      const e = c < 0 ? line.length : c;
      out.push(line.slice(i, e));
      i = e + 1;
    }
  }
  return out;
}

/** Calls fn(row object) for every line of a CSV file. */
async function eachRow(file, fn, sep = ',') {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let head = null;
  for await (let line of rl) {
    if (!line) continue;
    if (!head) {
      head = parseCsvLine(line.replace(/^﻿/, ''), sep);
      continue;
    }
    const v = parseCsvLine(line, sep);
    const o = {};
    for (let i = 0; i < head.length; i++) o[head[i]] = v[i];
    fn(o);
  }
}

const secs = (t) => {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

// local metric projection around Stephansplatz (only for distances inside this script)
const LAT0 = 48.2085, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540;
const mx = (lon) => lon * KX, my = (lat) => lat * KY;

async function fetchOsm() {
  const p = path.join(CACHE, 'osm-rail.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  let wait = 20;
  for (let i = 0; i < 30; i++) {
    const host = OVERPASS[i % OVERPASS.length];
    try {
      const r = await fetch(host, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(OSM_QUERY),
        headers: { 'User-Agent': 'wien3d-build', 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const t = await r.text();
      if (r.ok && t.startsWith('{')) {
        fs.writeFileSync(p, t);
        return JSON.parse(t);
      }
      console.log('overpass', host, r.status, `retrying in ${wait} s`);
    } catch (e) {
      console.log('overpass', host, e.message, `retrying in ${wait} s`);
    }
    await new Promise((s) => setTimeout(s, wait * 1000));
    wait = Math.min(wait * 1.5, 180);
  }
  throw new Error('Overpass unavailable, try again later');
}

// ---- download ---------------------------------------------------------------------------------
const dir = await extractGtfs(await download(GTFS_URL, 'gtfs.zip'));
const rblFile = await download(RBL_URL, 'haltepunkte.csv');
const osm = await fetchOsm();
const structures = JSON.parse(fs.readFileSync('public/data/structures.json', 'utf8')).structures;

// ---- DOM (deck heights) -------------------------------------------------------------------------
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
const toLaea = proj4('EPSG:4326', 'EPSG:3035');
const domImg = await (await fromFile(await download(DOM_URL, 'dom5.tif', '.cache'))).getImage();
const [domOx, domOy] = domImg.getOrigin(), [domRx, domRy] = domImg.getResolution();
const domW = domImg.getWidth(), domH = domImg.getHeight(), domNodata = Number(domImg.getGDALNoData());
console.log('reading DOM', domW, 'x', domH);
const dom = await domImg.readRasters({ interleave: true });
/** Surface height (m above Adriatic) around lon/lat: the upper middle of a 3 x 3 pixel window (deck, not street). */
function domAt(lon, lat) {
  const [x, y] = toLaea.forward([lon, lat]);
  const ci = Math.floor((x - domOx) / domRx), cj = Math.floor((y - domOy) / domRy), hs = [];
  for (let j = cj - 1; j <= cj + 1; j++)
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i >= domW || j >= domH) continue;
      const v = dom[j * domW + i];
      if (v !== domNodata && v > -50) hs.push(v + WIENER_NULL);
    }
  if (!hs.length) return null;
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length * 0.6)];
}

// ---- routes -----------------------------------------------------------------------------------
const routes = []; // [name, mode]
const routeIdx = new Map(); // `${name}|${mode}` -> index
const routeOf = new Map(); // route_id -> index
await eachRow(path.join(dir, 'routes.txt'), (r) => {
  const name = r.route_short_name;
  const type = Number(r.route_type);
  const mode = type === 1 ? METRO : type === 0 ? (r.agency_id === '03' ? WLB : TRAM) : /^N/.test(name) ? NIGHT : BUS;
  const k = `${name}|${mode}`;
  if (!routeIdx.has(k)) routeIdx.set(k, routes.push([name, mode]) - 1);
  routeOf.set(r.route_id, routeIdx.get(k));
});
console.log('lines', routes.length);

// ---- stops ------------------------------------------------------------------------------------
const gStops = new Map(); // stop_id -> { lon, lat, name }
await eachRow(path.join(dir, 'stops.txt'), (s) => gStops.set(s.stop_id, { lon: +s.stop_lon, lat: +s.stop_lat, name: s.stop_name }));

// ---- trips ------------------------------------------------------------------------------------
const tripInfo = new Map(); // trip_id -> { route, service, shape, headsign, dir }
await eachRow(path.join(dir, 'trips.txt'), (t) => {
  // H / R as in the realtime monitor's direction field (the id's last part); direction_id as a fallback
  const hr = /\.(H|R)$/.exec(t.trip_id)?.[1] ?? (t.direction_id === '1' ? 'R' : 'H');
  tripInfo.set(t.trip_id, { route: routeOf.get(t.route_id), service: t.service_id, shape: t.shape_id, headsign: t.trip_headsign, dir: hr === 'R' ? 1 : 0 });
});
console.log('trips', tripInfo.size);

// ---- services (read first: trips whose service has no day left are dropped) -------------------
const day = (d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 864e5; // days since 1970
const cal = new Map(); // service_id -> { mask, start, end, add: [], remove: [] }
const svc = (id) => {
  if (!cal.has(id)) cal.set(id, { mask: 0, start: 0, end: -1, add: [], remove: [] });
  return cal.get(id);
};
await eachRow(path.join(dir, 'calendar.txt'), (c) => {
  const s = svc(c.service_id);
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach((d, i) => c[d] === '1' && (s.mask |= 1 << i));
  s.start = day(c.start_date);
  s.end = day(c.end_date);
});
await eachRow(path.join(dir, 'calendar_dates.txt'), (c) => svc(c.service_id)[c.exception_type === '1' ? 'add' : 'remove'].push(day(c.date)));
// last day a service runs; yesterday's trips still run after midnight
const lastDay = (s) => Math.max(s.mask ? s.end : -1, ...s.add);
const keepFrom = Math.floor(Date.now() / 864e5) - 1;

// ---- stop times -> patterns, time profiles, trips ---------------------------------------------
const stopIdx = new Map(); // stop_id -> output index
const stopsOut = []; // [lonE6, latE6, nameIdx]
const names = [], nameIdx = new Map();
const str = (tbl, map, s) => {
  if (!map.has(s)) map.set(s, tbl.push(s) - 1);
  return map.get(s);
};
const useStop = (id) => {
  if (!stopIdx.has(id)) {
    const s = gStops.get(id);
    stopIdx.set(id, stopsOut.push([Math.round(s.lon * 1e6), Math.round(s.lat * 1e6), str(names, nameIdx, s.name)]) - 1);
  }
  return stopIdx.get(id);
};
const patterns = [], patternIdx = new Map(); // { route, shape, dir, headsign, stops[], dists[] }
const profiles = [], profileIdx = new Map(); // flat [arr0, dep0, arr1, dep1, ...] seconds after the first departure
const headsigns = [], headsignIdx = new Map();
const services = new Map(); // service_id -> index (filled from calendar later)
const tripGroups = new Map(); // `${pattern}|${profile}|${service}` -> start times
const usedShapes = new Set();
let seen = new Set(), cur = null, rows = [], nTrips = 0;

function flushTrip() {
  if (!cur || !rows.length) return;
  const info = tripInfo.get(cur);
  if (!info || info.route === undefined || !cal.has(info.service) || lastDay(cal.get(info.service)) < keepFrom) return;
  if (seen.has(cur)) console.warn('trip split across stop_times:', cur);
  seen.add(cur);
  rows.sort((a, b) => a.seq - b.seq);
  const t0 = rows[0].dep;
  const stops = rows.map((r) => useStop(r.stop));
  const dists = rows.map((r) => Math.round(r.dist * 10)); // decimetres along the shape
  const hs = str(headsigns, headsignIdx, info.headsign);
  const pk = `${info.route}|${info.shape}|${info.dir}|${hs}|${stops.join(',')}|${dists.join(',')}`;
  if (!patternIdx.has(pk)) patternIdx.set(pk, patterns.push({ route: info.route, shape: info.shape, dir: info.dir, headsign: hs, stops, dists }) - 1);
  usedShapes.add(info.shape);
  const prof = [];
  for (const r of rows) prof.push(r.arr - t0, r.dep - r.arr);
  const fk = prof.join(',');
  if (!profileIdx.has(fk)) profileIdx.set(fk, profiles.push(prof) - 1);
  if (!services.has(info.service)) services.set(info.service, services.size);
  const gk = `${patternIdx.get(pk)}|${profileIdx.get(fk)}|${services.get(info.service)}`;
  if (!tripGroups.has(gk)) tripGroups.set(gk, []);
  tripGroups.get(gk).push(t0);
  nTrips++;
}

console.log('reading stop_times (takes a while)');
await eachRow(path.join(dir, 'stop_times.txt'), (r) => {
  if (r.trip_id !== cur) {
    flushTrip();
    cur = r.trip_id;
    rows = [];
  }
  rows.push({ seq: +r.stop_sequence, arr: secs(r.arrival_time), dep: secs(r.departure_time), stop: r.stop_id, dist: +r.shape_dist_traveled || 0 });
});
flushTrip();
seen = null;
console.log('trips kept', nTrips, 'patterns', patterns.length, 'time profiles', profiles.length, 'groups', tripGroups.size);

let first = Infinity, last = -Infinity;
for (const id of services.keys()) {
  const s = svc(id);
  for (const d of [s.start, s.end, ...s.add]) if (d > 0) (first = Math.min(first, d)), (last = Math.max(last, d));
}
const delta = (a) => a.map((v, i) => (i ? v - a[i - 1] : v));
const servicesOut = [...services.keys()].map((id) => {
  const s = svc(id);
  return [s.mask, s.start - first, s.end - first, delta(s.add.sort((a, b) => a - b).map((d) => d - first)), delta(s.remove.sort((a, b) => a - b).map((d) => d - first))];
});
const isoDay = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
console.log('timetable', isoDay(first), '–', isoDay(last));

// ---- shapes -----------------------------------------------------------------------------------
const rawShapes = new Map(); // shape_id -> [[lon, lat, dist, seq]]
await eachRow(path.join(dir, 'shapes.txt'), (p) => {
  if (!usedShapes.has(p.shape_id)) return;
  if (!rawShapes.has(p.shape_id)) rawShapes.set(p.shape_id, []);
  rawShapes.get(p.shape_id).push([+p.shape_pt_lon, +p.shape_pt_lat, +p.shape_dist_traveled, +p.shape_pt_sequence]);
});

function simplify(pts) {
  // Douglas-Peucker in metres; keeps first and last
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = mx(pts[a][0]), ay = my(pts[a][1]), bx = mx(pts[b][0]), by = my(pts[b][1]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = mx(pts[i][0]) - ax, py = my(pts[i][1]) - ay;
      const t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > best) (best = d), (bi = i);
    }
    if (best > SIMPLIFY_M) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// OSM tracks in a 100 m grid, for the tunnel lookup
const GRID = 100;
const osmGrid = new Map();
let osmSegs = 0;
for (const w of osm.elements) {
  if (w.type !== 'way' || !w.geometry) continue;
  const t = w.tags || {};
  if (t.service) continue; // depot yards, sidings and crossovers next to the line would win the nearest match
  const rail = t.railway === 'subway' ? 'subway' : 'tram'; // tram and light_rail (Badner Bahn) share a class
  const tunnel = !!t.tunnel && t.tunnel !== 'no';
  const bridge = !!t.bridge && t.bridge !== 'no';
  const g = w.geometry.map((p) => [mx(p.lon), my(p.lat)]);
  for (let i = 0; i + 1 < g.length; i++) {
    const seg = { ax: g[i][0], ay: g[i][1], bx: g[i + 1][0], by: g[i + 1][1], rail, tunnel, bridge };
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - OSM_MATCH_M) / GRID), x1 = Math.floor((Math.max(seg.ax, seg.bx) + OSM_MATCH_M) / GRID);
    const y0 = Math.floor((Math.min(seg.ay, seg.by) - OSM_MATCH_M) / GRID), y1 = Math.floor((Math.max(seg.ay, seg.by) + OSM_MATCH_M) / GRID);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = x * 100000 + y;
        if (!osmGrid.has(k)) osmGrid.set(k, []);
        osmGrid.get(k).push(seg);
      }
    osmSegs++;
  }
}
console.log('osm track segments', osmSegs);

/** Nearest OSM track of that kind within OSM_MATCH_M, or null. */
function trackAt(x, y, rail) {
  let best = OSM_MATCH_M, res = null;
  for (const s of osmGrid.get(Math.floor(x / GRID) * 100000 + Math.floor(y / GRID)) || []) {
    if (s.rail !== rail) continue;
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
    const d = Math.hypot(x - s.ax - t * dx, y - s.ay - t * dy);
    // parallel open and tunnel tracks (portals, stations): the nearer wins, ties go to open air
    if (d < best - 0.5 || (d < best + 0.5 && res?.tunnel && !s.tunnel)) (best = Math.min(best, d)), (res = s);
  }
  return res;
}

// bridges, with the length of their long axis: a shape runs along a bridge when it stays on it for a good part of
// that length, and only crosses under it otherwise
const bridges = structures
  .filter((s) => s.k === 'b')
  .map((s) => {
    const n = s.v.length / 4, xs = [], ys = [];
    for (let i = 0; i < n; i++) xs.push(mx(s.v[i * 4])), ys.push(my(s.v[i * 4 + 1]));
    const cx = xs.reduce((a, b) => a + b) / n, cy = ys.reduce((a, b) => a + b) / n;
    let xx = 0, xy = 0, yy = 0;
    for (let i = 0; i < n; i++) (xx += (xs[i] - cx) ** 2), (xy += (xs[i] - cx) * (ys[i] - cy)), (yy += (ys[i] - cy) ** 2);
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy), ux = Math.cos(ang), uy = Math.sin(ang);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = (xs[i] - cx) * ux + (ys[i] - cy) * uy;
      lo = Math.min(lo, p), hi = Math.max(hi, p);
    }
    const rings = [];
    let start = 0;
    for (const end of s.r) rings.push([start, end]), (start = end);
    return { xs, ys, rings, axis: hi - lo, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
const bridgeGrid = new Map();
bridges.forEach((b, i) => {
  for (let x = Math.floor(b.minX / GRID); x <= Math.floor(b.maxX / GRID); x++)
    for (let y = Math.floor(b.minY / GRID); y <= Math.floor(b.maxY / GRID); y++) {
      const k = x * 100000 + y;
      if (!bridgeGrid.has(k)) bridgeGrid.set(k, []);
      bridgeGrid.get(k).push(i);
    }
});
function bridgeAt(x, y) {
  for (const i of bridgeGrid.get(Math.floor(x / GRID) * 100000 + Math.floor(y / GRID)) || []) {
    const b = bridges[i];
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    let inside = false;
    for (const [i0, i1] of b.rings)
      for (let p = i0, q = i1 - 1; p < i1; q = p++)
        if (b.ys[p] > y !== b.ys[q] > y && x < ((b.xs[q] - b.xs[p]) * (y - b.ys[p])) / (b.ys[q] - b.ys[p]) + b.xs[p]) inside = !inside;
    if (inside) return i;
  }
  return -1;
}

/** Runs [from, to] (decimetres along the shape) where flag(sample) is true, cleaned of short flickers. */
function runs(samples, flags) {
  // fill unknowns from the previous sample, then merge short stretches into their surroundings
  let prev = false;
  const f = flags.map((v) => (v === null ? prev : (prev = v)));
  const segs = [];
  for (let i = 0; i < f.length; i++) {
    if (!segs.length || segs[segs.length - 1].v !== f[i]) segs.push({ v: f[i], a: i, b: i });
    else segs[segs.length - 1].b = i;
  }
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (samples[s.b].d - samples[s.a].d >= MIN_RUN_M) continue;
      s.v = !s.v;
      changed = true;
      // merge with equal neighbours
      for (let j = segs.length - 1; j > 0; j--)
        if (segs[j].v === segs[j - 1].v) (segs[j - 1].b = segs[j].b), segs.splice(j, 1);
      break;
    }
  }
  return segs.filter((s) => s.v).map((s) => [Math.round(samples[s.a].d * 10), Math.round(samples[s.b].d * 10)]);
}

const shapeMode = new Map(); // shape_id -> mode of the first line using it
for (const p of patterns) if (!shapeMode.has(p.shape)) shapeMode.set(p.shape, routes[p.route][1]);
const shapesOut = [], shapeIdx = new Map(), geomIdx = new Map();
let nPts = 0, tunnelM = 0, bridgeM = 0;
for (const [id, raw] of rawShapes) {
  raw.sort((a, b) => a[3] - b[3]);
  const pts = simplify(raw);
  // dense samples along the original shape: [x, y, distance]
  const samples = [];
  for (let i = 0; i + 1 < raw.length; i++) {
    const [lo0, la0, d0] = raw[i], [lo1, la1, d1] = raw[i + 1];
    const n = Math.max(1, Math.ceil((d1 - d0) / SAMPLE_M));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      samples.push({ x: mx(lo0 + (lo1 - lo0) * t), y: my(la0 + (la1 - la0) * t), d: d0 + (d1 - d0) * t });
    }
  }
  const [loN, laN, dN] = raw[raw.length - 1];
  samples.push({ x: mx(loN), y: my(laN), d: dN });

  const mode = shapeMode.get(id);
  const rail = mode === METRO ? 'subway' : mode === TRAM || mode === WLB ? 'tram' : null;
  const tracks = rail ? samples.map((s) => trackAt(s.x, s.y, rail)) : [];
  const tunnels = rail ? runs(samples, tracks.map((t) => t && t.tunnel)) : [];
  // bridge stretches: OSM bridges, or consecutive samples on one bridge footprint, long compared to its axis
  const onBridge = samples.map((_, i) => !!tracks[i]?.bridge);
  for (let i = 0; i < samples.length; ) {
    const b = bridgeAt(samples[i].x, samples[i].y);
    if (b < 0) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && bridgeAt(samples[j + 1].x, samples[j + 1].y) === b) j++;
    if (samples[j].d - samples[i].d >= Math.max(15, 0.45 * bridges[b].axis)) for (let k = i; k <= j; k++) onBridge[k] = true;
    i = j + 1;
  }
  const bridgeRuns = onBridge.some(Boolean) ? runs(samples, onBridge) : [];
  for (const [a, b] of tunnels) tunnelM += (b - a) / 10;
  for (const [a, b] of bridgeRuns) bridgeM += (b - a) / 10;
  // deck heights every DECK_STEP_M along each bridge stretch, median-filtered (trains or trees in the DOM)
  const lonLatAt = (d) => {
    let i = 0;
    while (i < raw.length - 2 && raw[i + 1][2] < d) i++;
    const [lo0, la0, d0] = raw[i], [lo1, la1, d1] = raw[i + 1];
    const t = d1 > d0 ? Math.max(0, Math.min(1, (d - d0) / (d1 - d0))) : 0;
    return [lo0 + (lo1 - lo0) * t, la0 + (la1 - la0) * t];
  };
  const decks = bridgeRuns.map(([a, b]) => {
    const n = Math.max(1, Math.ceil((b - a) / 10 / DECK_STEP_M));
    const h = [];
    for (let k = 0; k <= n; k++) h.push(domAt(...lonLatAt(a / 10 + ((b - a) / 10) * (k / n))));
    const filled = h.map((v, k) => v ?? h.find((w) => w !== null) ?? 0);
    const med = filled.map((_, k) => {
      const w = filled.slice(Math.max(0, k - 2), k + 3).sort((p, q) => p - q);
      return Math.round(w[w.length >> 1] * 10);
    });
    return delta(med);
  });

  const lon = pts.map((p) => Math.round(p[0] * 1e6)), lat = pts.map((p) => Math.round(p[1] * 1e6)), dist = pts.map((p) => Math.round(p[2] * 10));
  const entry = [delta(lon), delta(lat), delta(dist), tunnels.flat(), bridgeRuns.flat(), decks];
  const gk = JSON.stringify(entry);
  if (!geomIdx.has(gk)) {
    geomIdx.set(gk, shapesOut.push(entry) - 1);
    nPts += pts.length;
  }
  shapeIdx.set(id, geomIdx.get(gk));
}
console.log('shapes', shapesOut.length, 'points', nPts, `tunnels ${Math.round(tunnelM / 1000)} km, bridges ${Math.round(bridgeM / 1000)} km (summed over shapes)`);

// ---- realtime stop ids (RBL) near the timetable's stops ---------------------------------------
const stopGrid = new Map();
for (const [lonE6, latE6] of stopsOut) {
  const x = mx(lonE6 / 1e6), y = my(latE6 / 1e6), k = Math.floor(x / GRID) * 100000 + Math.floor(y / GRID);
  if (!stopGrid.has(k)) stopGrid.set(k, []);
  stopGrid.get(k).push([x, y]);
}
const rbl = [];
await eachRow(
  rblFile,
  (r) => {
    const lon = +r.Longitude, lat = +r.Latitude, id = +r.StopID;
    if (!id || !lon || !lat) return;
    const x = mx(lon), y = my(lat);
    let near = false;
    for (let gx = -1; gx <= 1 && !near; gx++)
      for (let gy = -1; gy <= 1 && !near; gy++)
        for (const [sx, sy] of stopGrid.get((Math.floor(x / GRID) + gx) * 100000 + Math.floor(y / GRID) + gy) || []) if (Math.hypot(sx - x, sy - y) < 80) near = true;
    if (near) rbl.push([id, Math.round(lon * 1e5), Math.round(lat * 1e5)]);
  },
  ';'
);
rbl.sort((a, b) => a[0] - b[0]);
console.log('rbl', rbl.length);

// ---- write ------------------------------------------------------------------------------------
const trips = [...tripGroups].map(([k, starts]) => [...k.split('|').map(Number), delta(starts.sort((a, b) => a - b))]);
const out = {
  v: 1,
  generated: new Date().toISOString().slice(0, 10),
  firstDay: isoDay(first),
  lastDay: isoDay(last),
  routes,
  headsigns,
  names,
  stops: [delta(stopsOut.map((s) => s[0])), delta(stopsOut.map((s) => s[1])), stopsOut.map((s) => s[2])],
  shapes: shapesOut,
  // [route, shape, H=0 / R=1, headsign, stop index deltas, stop distance (dm) deltas]
  patterns: patterns.map((p) => [p.route, shapeIdx.get(p.shape), p.dir, p.headsign, delta(p.stops), delta(p.dists)]),
  profiles,
  services: servicesOut,
  // [pattern, profile, service, first departures (s after the service day's midnight) as deltas]
  trips,
  rbl: [delta(rbl.map((r) => r[0])), delta(rbl.map((r) => r[1])), delta(rbl.map((r) => r[2]))],
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
