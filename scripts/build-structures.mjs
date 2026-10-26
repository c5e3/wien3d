// Preprocess bridges (MA 29, ASFINAG, Wiener Linien) into public/data/structures.json.
// Tunnels are left out: no source has their depth.
//
// Sources (all OGD, CC BY 4.0):
//  - Stadt Wien WFS "ogdwien:BRUECKENOGD"  – bridge/tunnel footprints, no heights (heavily duplicated -> deduped)
//  - Brückeninformation Wien (wien.gv.at/bruecken) – Wiener Linien bridges, which the OGD export leaves out
//  - Stadt Wien DOM 5 m (surface model, COG, EPSG:3035) – deck heights, read locally because the server sends no CORS
//  - Terrarium tiles (Austrian OGD DGM 10 m) – bare-earth terrain, same source the client uses
//
// Usage: node scripts/build-structures.mjs   (downloads ~370 MB into .cache on first run)

import fs from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';
import { ShapeUtils, Vector2 } from 'three';

const CACHE = '.cache';
const WIENER_NULL = 156.68; // the DOM is relative to Vienna's local datum, terrain is above Adriatic
const OUT = 'public/data/structures.json';
const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json';
const DOM_URL = 'https://www.wien.gv.at/data/inspire/AT_0052_R_13_DOM5_2023_COG.tif';

proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
const toLaea = proj4('EPSG:4326', 'EPSG:3035');
proj4.defs('EPSG:31256', '+proj=tmerc +lat_0=0 +lon_0=16.33333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs');
const toGk = proj4('EPSG:4326', 'EPSG:31256');

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

async function download(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  console.log('downloading', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return p;
}

// ---- DOM ---------------------------------------------------------------------------------------
const domFile = await download(DOM_URL, 'dom5.tif');
const tiff = await fromFile(domFile);
const img = await tiff.getImage();
const [ox, oy] = img.getOrigin();
const [rx, ry] = img.getResolution();
const W = img.getWidth(), H = img.getHeight();
const NODATA = Number(img.getGDALNoData());
console.log('reading DOM', W, 'x', H);
const dom = (await img.readRasters({ interleave: true }));
const domPx = (i, j) => {
  if (i < 0 || j < 0 || i >= W || j >= H) return null;
  const v = dom[j * W + i];
  return v === NODATA || !(v > -50) ? null : v + WIENER_NULL;
};

// ---- terrain (terrarium z14, identical sampling to the client) --------------------------------
const TZ = 14;
const terrTiles = new Map();
async function terrTile(x, y) {
  const k = `${x},${y}`;
  if (terrTiles.has(k)) return terrTiles.get(k);
  const f = await download(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`, `terrarium_${TZ}_${x}_${y}.png`);
  const png = PNG.sync.read(fs.readFileSync(f));
  const d = new Float32Array(256 * 256);
  for (let i = 0; i < d.length; i++) d[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  terrTiles.set(k, d);
  return d;
}
function lonLatToGlobalPx(lon, lat) {
  const n = 2 ** TZ * 256;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x - 0.5, y - 0.5];
}
async function terrainAt(lon, lat) {
  const [gx, gy] = lonLatToGlobalPx(lon, lat);
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const px = async (x, y) => {
    const t = await terrTile(Math.floor(x / 256), Math.floor(y / 256));
    return t[(y - Math.floor(y / 256) * 256) * 256 + (x - Math.floor(x / 256) * 256)];
  };
  const [a, b, c, d] = await Promise.all([px(ix, iy), px(ix + 1, iy), px(ix, iy + 1), px(ix + 1, iy + 1)]);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// ---- footprints ----------------------------------------------------------------------------
const brFile = await download(`${WFS}&typeName=ogdwien:BRUECKENOGD&propertyName=ART,BEZIRK,NUMMER,TEIL,OBJEKTNUMMER,LAENGE,OBJEKT,SHAPE`, 'br.json');
console.log('parsing footprints');
const raw = JSON.parse(fs.readFileSync(brFile, 'utf8')).features;
const uniq = new Map();
for (const f of raw) {
  if (!f.geometry) continue;
  const k = JSON.stringify(f.geometry.coordinates);
  const e = uniq.get(k);
  if (!e || (!e.properties.OBJEKT && f.properties.OBJEKT)) uniq.set(k, f);
}
console.log(raw.length, 'records ->', uniq.size, 'unique structures');

// ---- Wiener Linien bridges (Brückeninformation Wien viewer) -----------------------------------
// The viewer has no plain API: a session is opened via start.aspx, the Wiener Linien layers are
// switched on through the layer check state, and circles are queried with MapIdentify. Each layer
// answers with at most 100 objects, so crowded circles are split until no layer is capped.
const WL_BASE = 'https://www.wien.gv.at/bruecken';
const WL_CAP = 100;

const unescapeJs = (s) =>
  s.replace(/\\(.)/g, '$1').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// the viewer answers with JavaScript object literals (unquoted keys, single-quoted strings)
function parseJsLiteral(s, i) {
  const take = (re) => {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`unexpected ${JSON.stringify(s.slice(i, i + 40))}`);
    i = re.lastIndex;
    return m;
  };
  const WS = /\s*/y, KEY = /\s*(?:([\w$]+)|'((?:[^'\\]|\\.)*)')\s*:/y, STR = /'((?:[^'\\]|\\.)*)'/y;
  const NUM = /-?\d[\d.]*(?:e[-+]?\d+)?/iy, WORD = /true|false|null/y, SEP = /\s*([,}\]])/y;
  function value() {
    take(WS);
    const c = s[i];
    if (c === '{') {
      i++;
      const o = {};
      take(WS);
      if (s[i] === '}') return i++, o;
      for (;;) {
        const k = take(KEY);
        o[k[1] ?? unescapeJs(k[2])] = value();
        if (take(SEP)[1] === '}') return o;
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      take(WS);
      if (s[i] === ']') return i++, a;
      for (;;) {
        a.push(value());
        if (take(SEP)[1] === ']') return a;
      }
    }
    if (c === "'") return unescapeJs(take(STR)[1]);
    if (c === '-' || (c >= '0' && c <= '9')) return +take(NUM)[0];
    const w = take(WORD)[0];
    return w === 'true' ? true : w === 'false' ? false : null;
  }
  return value();
}

async function wlSession() {
  let cookie = '';
  const get = async (url) => {
    const r = await fetch(url, { headers: { cookie, referer: `${WL_BASE}/public/start.aspx` } });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0], k = kv.split('=')[0];
      cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), kv].join('; ');
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
  };
  const h = await get(`${WL_BASE}/public/start.aspx`);
  const id = h.match(/CacheID : '([^']+)'/)[1];
  const tail = `&lang=de-AT&lts=${h.match(/lWrTS : '([^']+)'/)[1]}&lta=${h.match(/lWrTA : '([^']+)'/)[1]}`;
  // check state as the viewer sends it: one bit per layer index, as hex plus ",<length % 4>"
  const layers = [...h.matchAll(/\{ID : '(\w+)',checked : \w+[^{}]*?(?:\{[^{}]*\}[^{}]*?)*index : (\d+)\}/g)];
  const bits = Array(Math.max(...layers.map((m) => +m[2])) + 1).fill('0');
  for (const [, name, idx] of layers) if (/^(wienerLinien|bruecken_wl|mauern_wrl|tunnelUndEindeckungen)$/.test(name)) bits[+idx] = '1';
  let hex = '';
  for (let k = 0; k < bits.length; k += 4) hex += parseInt(bits.slice(k, k + 4).join('').padEnd(4, '0'), 2).toString(16).toUpperCase();
  const check = `&c=${hex},${bits.length % 4}`;
  let ln = 0;
  const call = async (what, query) => {
    const t = await get(`${WL_BASE}/ajax/${what}?ln=${++ln}&id=${id}${query}${check}${tail}&lkey=l${ln}`);
    if (!t.startsWith('GisWebControl.AjaxLoaded')) throw new Error(`${what}: ${t.slice(0, 120)}`);
    return parseJsLiteral(t, t.indexOf('{'));
  };
  // identify only searches layers visible at the current view: 400 px at ~0.5 m/px around the circle
  const KS = 5, MPP = 33.0729828126323 / 2 ** (11 - KS);
  return async (x, y, rad) => {
    const view = `&l=${x - 200 * MPP}&b=${y - 200 * MPP}&iw=400&ih=400&ks=${KS}&mpp=${MPP}`;
    await call('MapInfo.ctrl', view);
    const res = await call('MapIdentify.ctrlsession', `${view}&cx=${x}&cy=${y}&rad=${rad}`);
    if (res.NewSMsg) throw new Error('viewer session outdated');
    return Object.values(res.Collection?.Groups || {});
  };
}

async function fetchWienerLinien() {
  const file = path.join(CACHE, 'wl.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let identify = await wlSession();
  const [x0, y0] = toGk.forward([16.17, 48.11]), [x1, y1] = toGk.forward([16.59, 48.33]);
  const S0 = 8000;
  const queue = [];
  for (let x = x0; x < x1; x += S0) for (let y = y0; y < y1; y += S0) queue.push([x + S0 / 2, y + S0 / 2, S0]);
  const objs = new Map();
  let requests = 0;
  while (queue.length) {
    const [cx, cy, size] = queue.pop();
    let groups;
    for (let attempt = 0; ; attempt++) {
      try {
        groups = await identify(cx, cy, size * Math.SQRT1_2 + 5);
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 2000));
        identify = await wlSession();
      }
    }
    requests++;
    for (const g of groups) if (/^identify_wl_/.test(g.ID)) for (const f of g.Features) objs.set(f.Attributes.OBJECTID, f);
    if (size > 200 && groups.some((g) => g.Features.length >= WL_CAP)) {
      const q = size / 4;
      for (const dx of [-q, q]) for (const dy of [-q, q]) queue.push([cx + dx, cy + dy, size / 2]);
    }
    process.stdout.write(`\rWiener Linien: ${requests} requests, ${objs.size} objects, ${queue.length} queued   `);
  }
  console.log();
  // Geometries[].poly: points in GK M34; 'm' starts a ring (first = outline, rest = holes)
  const out = [...objs.values()].map((f) => {
    const a = f.Attributes;
    const polys = (f.Geometries || []).filter((g) => g.poly).map((g) => {
      const rings = [];
      for (const p of g.poly) {
        if (p.t === 'm' || !rings.length) rings.push([]);
        rings[rings.length - 1].push(toGk.inverse([p.x, p.y]).map((v) => +v.toFixed(8)));
      }
      return rings.filter((r) => r.length >= 3);
    }).filter((rs) => rs.length);
    return { p: { ART: a.ART, NAME: a.NAME, LINIE: a.LINIE, NUMMER: a.NUMMER, TEIL: a.TEIL ?? null, NR: a.BESCHREIBUNG }, polys };
  });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

const wl = await fetchWienerLinien();
console.log(wl.length, 'Wiener Linien objects', Object.entries(Object.groupBy(wl, (o) => o.p.ART)).map(([k, v]) => `${k}:${v.length}`).join(' '));
// bridges plus the Stadtbahn arch viaducts ("Gewölbe", filed as covers). The other covers (E),
// tunnels (T) and walls (S) are underground or at grade and not built.
for (const o of wl) {
  const vault = o.p.ART === 'E' && /^gew(ö|oe)lbe/i.test(o.p.NAME || '');
  if ((o.p.ART !== 'B' && !vault) || !o.polys.length) continue;
  uniq.set(`wl:${o.p.NR}:${uniq.size}`, {
    properties: { ART: 'B', OBJEKT: o.p.NAME, OBJEKTNUMMER: o.p.NR, LAENGE: null, op: 'Wiener Linien', solid: vault },
    geometry: { type: 'MultiPolygon', coordinates: o.polys },
  });
}

// OGD records without object number are the viewer's "nicht zugeordnete Objekte" (no known operator)
const operatorOf = (p) => p.op || (p.ART == null ? 'ASFINAG' : p.OBJEKTNUMMER ? 'MA 29' : null);
const isTunnel = (name) => /tunnel|einhausung|galerie/i.test(name || '');
const isFoot = (name) => /steg|fu(ß|ss)g|fu(ß|ss)weg|personen|rad(weg|fahr)/i.test(name || '');

// ---- helpers (all geometry in LAEA metres) ----------------------------------------------------
const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
};
function pointInRings(rings, x, y) {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
function densify(ring, maxLen) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push(a);
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen);
    for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n, a[3] + ((b[3] - a[3]) * k) / n]);
  }
  return out;
}
// move every vertex d metres into the polygon (along the corner bisector), keeping coplanar walls apart
function inset(rings, d) {
  return rings.map((r) =>
    r.map((v, i) => {
      const a = r[(i + r.length - 1) % r.length], b = r[(i + 1) % r.length];
      const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]) || 1, l2 = Math.hypot(b[0] - v[0], b[1] - v[1]) || 1;
      let nx = -(v[1] - a[1]) / l1 - (b[1] - v[1]) / l2, ny = (v[0] - a[0]) / l1 + (b[0] - v[0]) / l2;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const s = pointInRings(rings, v[0] + nx * 0.05, v[1] + ny * 0.05) ? 1 : -1;
      return [v[0] + s * nx * d, v[1] + s * ny * d, ...v.slice(2)];
    })
  );
}
function axisOf(pts) {
  let mx = 0, my = 0;
  for (const p of pts) (mx += p[0]), (my += p[1]);
  mx /= pts.length; my /= pts.length;
  let xx = 0, xy = 0, yy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    xx += dx * dx; xy += dx * dy; yy += dy * dy;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let t0 = Infinity, t1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const p of pts) {
    const t = (p[0] - mx) * ux + (p[1] - my) * uy;
    const w = -(p[0] - mx) * uy + (p[1] - my) * ux;
    t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    w0 = Math.min(w0, w); w1 = Math.max(w1, w);
  }
  return { mx, my, ux, uy, t0, t1, width: w1 - w0, wc: (w0 + w1) / 2 };
}

// ---- building model (FMZK) ------------------------------------------------------------------
// DOM pixels on buildings, canopies and overhangs say nothing about whether a footprint is raised:
// the Donau City platform over the A22 is part of the terrain, only the buildings on it stick out.
const FMZK_FILE = path.join(CACHE, 'fmzk-bridges.json');
const fmzkCache = fs.existsSync(FMZK_FILE) ? JSON.parse(fs.readFileSync(FMZK_FILE, 'utf8')) : {};
let fmzkFetched = 0;
async function buildingsIn(w, s, e, n) {
  const k = [w, s, e, n].map((v) => v.toFixed(5)).join(',');
  if (!fmzkCache[k]) {
    const r = await fetch(`${WFS}&typeName=ogdwien:FMZKBKMOGD&propertyName=LAYER,SHAPE&bbox=${k},EPSG:4326`);
    if (!r.ok) throw new Error(`FMZK ${r.status} ${k}`);
    fmzkCache[k] = (await r.json()).features
      .filter((f) => f.geometry && /^(Gebäude|Überbauung|Glashaus|Flugdach)$/.test(f.properties.LAYER))
      .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))
      .map((poly) => ({ poly: poly.map((r) => r.map(([lon, lat]) => [+lon.toFixed(7), +lat.toFixed(7)])) }));
    if (++fmzkFetched % 100 === 0) fs.writeFileSync(FMZK_FILE, JSON.stringify(fmzkCache));
  }
  // LAEA rings + bbox per building part
  return fmzkCache[k].map(({ poly }) => {
    const rings = poly.map((r) => r.map((q) => toLaea.forward(q)));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of rings[0]) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
    return { rings, x0, x1, y0, y1 };
  });
}

// ---- process -----------------------------------------------------------------------------
const structures = [];
const stats = { bridge: 0, skippedTunnel: 0, skippedAtGrade: 0, skippedBuilt: 0, ops: {} };

for (const f of uniq.values()) {
  const p = f.properties;
  const name = p.OBJEKT || '';
  // no source has tunnel depths, and guessed ones end up above ground
  if (p.ART === 'T' || isTunnel(name)) {
    stats.skippedTunnel++;
    continue;
  }
  const op = operatorOf(p);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    // rings in LAEA [x, y, lon, lat]
    let rings = poly.map((r) => {
      const pts = r.map(([lon, lat]) => [...toLaea.forward([lon, lat]), lon, lat]);
      const a = pts[0], z = pts[pts.length - 1];
      if (a[0] === z[0] && a[1] === z[1]) pts.pop();
      return pts;
    }).filter((r) => r.length >= 3);
    if (!rings.length) continue;

    // DOM pixels inside the footprint, flagged when on a building
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x)), (minY = Math.min(minY, y)), (maxY = Math.max(maxY, y));
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const q of rings[0]) (w = Math.min(w, q[2])), (e = Math.max(e, q[2])), (s = Math.min(s, q[3])), (n = Math.max(n, q[3]));
    const buildings = await buildingsIn(w, s, e, n);
    const onBuilding = (x, y) => buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && pointInRings(b.rings, x, y));
    const inside = [];
    for (let j = Math.floor((oy - maxY) / -ry); j <= Math.ceil((oy - minY) / -ry); j++)
      for (let i = Math.floor((minX - ox) / rx); i <= Math.ceil((maxX - ox) / rx); i++) {
        const cx = ox + (i + 0.5) * rx, cy = oy + (j + 0.5) * ry;
        if (!pointInRings(rings, cx, cy)) continue;
        const h = domPx(i, j);
        if (h !== null) inside.push([cx, cy, h, onBuilding(cx, cy)]);
      }
    const ax = axisOf(rings[0]);
    // narrow footprints: fall back to the max of the DOM around points on the centre line
    if (inside.length < 3) {
      const n = Math.max(2, Math.ceil((ax.t1 - ax.t0) / 4));
      for (let k = 0; k <= n; k++) {
        const t = ax.t0 + ((ax.t1 - ax.t0) * k) / n;
        const cx = ax.mx + ax.ux * t - ax.uy * ax.wc, cy = ax.my + ax.uy * t + ax.ux * ax.wc;
        const i = Math.floor((cx - ox) / rx), j = Math.floor((cy - oy) / ry);
        const hs = [domPx(i, j), domPx(i + 1, j), domPx(i, j + 1), domPx(i - 1, j), domPx(i, j - 1)].filter((v) => v !== null);
        if (hs.length) inside.push([cx, cy, Math.max(...hs), onBuilding(cx, cy)]);
      }
    }
    if (!inside.length) continue;

    const deckAt = (x, y) => {
      for (const R of [10, 25, 1e9]) {
        const near = inside.filter((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 < R * R).map((q) => q[2]);
        if (near.length >= 3 || R === 1e9) return pct(near, 0.4);
      }
    };

    // clearance between surface model and bare earth tells bridge (deck above ground) from at-grade;
    // buildings don't count, and a footprint entirely under buildings is drawn by the building model
    const open = inside.filter((q) => !q[3]);
    if (!open.length) {
      stats.skippedBuilt++;
      continue;
    }
    const sampleIdx = open.length > 40 ? open.filter((_, i) => i % Math.ceil(open.length / 40) === 0) : open;
    const clear = [];
    for (const [x, y, h] of sampleIdx) {
      const [lon, lat] = toLaea.inverse([x, y]);
      clear.push(h - (await terrainAt(lon, lat)));
    }
    const clearance = pct(clear, 0.5);
    if (clearance < 1.2) {
      stats.skippedAtGrade++;
      continue;
    }

    // per-vertex heights: [x, y, a, b] (a = deck top, b = deck underside; solid viaducts reach into the ground)
    const maxSeg = 8;
    rings = rings.map((r) => r.map(([x, y]) => [x, y, 0, 0]));
    rings = rings.map((r) => densify(r, maxSeg));
    // solid viaducts share their walls with arch buildings of the building model: stay behind them
    if (p.solid) rings = inset(rings, 0.5);
    const foot = isFoot(name);
    const thick = foot ? 0.8 : 1.6;
    for (const r of rings)
      for (const v of r) {
        const [lon, lat] = toLaea.inverse([v[0], v[1]]);
        const g = await terrainAt(lon, lat);
        v[2] = Math.max(deckAt(v[0], v[1]), g + 0.15);
        v[3] = p.solid ? g - 0.5 : v[2] - thick;
      }
    // piers along the axis where the deck is well above the ground
    const piers = [];
    const len = ax.t1 - ax.t0;
    const spacing = foot ? 25 : 35;
    if (len > 30 && !p.solid) {
      const n = Math.floor((len - 16) / spacing);
      for (let k = 1; k <= n; k++) {
        const t = ax.t0 + 8 + ((len - 16) * k) / (n + 1);
        const cx = ax.mx + ax.ux * t - ax.uy * ax.wc, cy = ax.my + ax.uy * t + ax.ux * ax.wc;
        if (!pointInRings(rings, cx, cy)) continue;
        const [lon, lat] = toLaea.inverse([cx, cy]);
        const bottom = deckAt(cx, cy) - thick;
        if (bottom - (await terrainAt(lon, lat)) < 3) continue;
        piers.push([+lon.toFixed(7), +lat.toFixed(7), +bottom.toFixed(2), +Math.min(Math.max(ax.width * 0.55, 1), 14).toFixed(1), foot ? 0.6 : 1.4]);
      }
    }
    const structure = { k: 'b', piers };
    stats.bridge++;

    // triangulate in LAEA
    const contour = rings[0].map((v) => new Vector2(v[0], v[1]));
    const holes = rings.slice(1).map((r) => r.map((v) => new Vector2(v[0], v[1])));
    let tris;
    try {
      tris = ShapeUtils.triangulateShape(contour, holes).flat();
    } catch {
      continue;
    }
    if (!tris.length) continue;

    const flat = rings.flat();
    const v = [];
    for (const q of flat) {
      const [lon, lat] = toLaea.inverse([q[0], q[1]]);
      v.push(+lon.toFixed(7), +lat.toFixed(7), +q[2].toFixed(2), +q[3].toFixed(2));
    }
    const r = [];
    let acc = 0;
    for (const ring of rings) r.push((acc += ring.length));
    structures.push({ n: name, op, id: p.OBJEKTNUMMER || null, len: p.LAENGE || null, ...structure, v, r, t: tris });
    stats.ops[op] = (stats.ops[op] || 0) + 1;
  }
}

fs.writeFileSync(FMZK_FILE, JSON.stringify(fmzkCache));
fs.writeFileSync(OUT, JSON.stringify({ attribution: 'Stadt Wien – data.wien.gv.at (CC BY 4.0): Brücken (MA 29, ASFINAG, Wiener Linien), DOM 5 m', structures }));
console.log(stats, OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), 'MB');
