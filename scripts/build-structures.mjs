// Preprocess bridges & tunnels (MA 29, ASFINAG, Wiener Linien) into public/data/structures.json.
//
// Sources (all OGD, CC BY 4.0):
//  - Stadt Wien WFS "ogdwien:BRUECKENOGD"  – bridge/tunnel footprints, no heights (heavily duplicated -> deduped)
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

const operatorOf = (p) => (p.ART == null ? 'ASFINAG' : p.OBJEKTNUMMER ? 'MA 29' : 'Wiener Linien');
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

// ---- process -----------------------------------------------------------------------------
const structures = [];
const stats = { bridge: 0, tunnel: 0, skippedAtGrade: 0, ops: {} };

for (const f of uniq.values()) {
  const p = f.properties;
  const name = p.OBJEKT || '';
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

    // DOM pixels inside the footprint
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x)), (minY = Math.min(minY, y)), (maxY = Math.max(maxY, y));
    const inside = [];
    for (let j = Math.floor((oy - maxY) / -ry); j <= Math.ceil((oy - minY) / -ry); j++)
      for (let i = Math.floor((minX - ox) / rx); i <= Math.ceil((maxX - ox) / rx); i++) {
        const cx = ox + (i + 0.5) * rx, cy = oy + (j + 0.5) * ry;
        if (!pointInRings(rings, cx, cy)) continue;
        const h = domPx(i, j);
        if (h !== null) inside.push([cx, cy, h]);
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
        if (hs.length) inside.push([cx, cy, Math.max(...hs)]);
      }
    }
    if (!inside.length) continue;

    const deckAt = (x, y) => {
      for (const R of [10, 25, 1e9]) {
        const near = inside.filter((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 < R * R).map((q) => q[2]);
        if (near.length >= 3 || R === 1e9) return pct(near, 0.4);
      }
    };

    // clearance between surface model and bare earth tells bridge (deck above ground) from at-grade
    const sampleIdx = inside.length > 40 ? inside.filter((_, i) => i % Math.ceil(inside.length / 40) === 0) : inside;
    const clear = [];
    for (const [x, y, h] of sampleIdx) {
      const [lon, lat] = toLaea.inverse([x, y]);
      clear.push(h - (await terrainAt(lon, lat)));
    }
    const clearance = pct(clear, 0.5);
    const tunnel = isTunnel(name);
    if (!tunnel && clearance < 1.2) {
      stats.skippedAtGrade++;
      continue;
    }

    // per-vertex heights: [x, y, a, b] (bridge: a=top, b=bottom; tunnel: a=floor, b=roof)
    const maxSeg = 8;
    rings = rings.map((r) => r.map(([x, y]) => [x, y, 0, 0]));
    rings = rings.map((r) => densify(r, maxSeg));
    const foot = isFoot(name);
    let structure;
    if (!tunnel) {
      const thick = foot ? 0.8 : 1.6;
      for (const r of rings)
        for (const v of r) {
          const [lon, lat] = toLaea.inverse([v[0], v[1]]);
          const g = await terrainAt(lon, lat);
          v[2] = Math.max(deckAt(v[0], v[1]), g + 0.15);
          v[3] = v[2] - thick;
        }
      // piers along the axis where the deck is well above the ground
      const piers = [];
      const len = ax.t1 - ax.t0;
      const spacing = foot ? 25 : 35;
      if (len > 30) {
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
      structure = { k: 'b', piers };
      stats.bridge++;
    } else {
      const clearH = foot ? 3 : 5;
      const endG = [];
      for (const t of [ax.t0 - 3, ax.t1 + 3]) {
        const cx = ax.mx + ax.ux * t - ax.uy * ax.wc, cy = ax.my + ax.uy * t + ax.ux * ax.wc;
        endG.push(await terrainAt(...toLaea.inverse([cx, cy])));
      }
      for (const r of rings)
        for (const v of r) {
          const [lon, lat] = toLaea.inverse([v[0], v[1]]);
          const g = await terrainAt(lon, lat);
          const t = Math.min(1, Math.max(0, ((v[0] - ax.mx) * ax.ux + (v[1] - ax.my) * ax.uy - ax.t0) / (ax.t1 - ax.t0 || 1)));
          v[2] = endG[0] + (endG[1] - endG[0]) * t; // floor
          v[3] = Math.max(g, v[2] + clearH + 0.6, Math.min(deckAt(v[0], v[1]), v[2] + 12)); // roof top
        }
      structure = { k: 't', c: clearH };
      stats.tunnel++;
    }

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
    // portal edges for tunnels: short edges at the axis ends, roughly perpendicular to the axis
    if (structure.k === 't') {
      const open = [];
      let base = 0;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const t = ((a[0] + b[0]) / 2 - ax.mx) * ax.ux + ((a[1] + b[1]) / 2 - ax.my) * ax.uy;
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          const along = Math.abs((dx * ax.ux + dy * ax.uy) / l);
          const nearEnd = Math.min(t - ax.t0, ax.t1 - t) < Math.max(4, (ax.t1 - ax.t0) * 0.04);
          if (nearEnd && along < 0.6) open.push(base + i);
        }
        base += ring.length;
      }
      structure.open = open;
    }
    structures.push({ n: name, op, ...structure, v, r, t: tris });
    stats.ops[op] = (stats.ops[op] || 0) + 1;
  }
}

fs.writeFileSync(OUT, JSON.stringify({ attribution: 'Stadt Wien – data.wien.gv.at (CC BY 4.0): Brücken (MA 29, ASFINAG, Wiener Linien), DOM 5 m', structures }));
console.log(stats, OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), 'MB');
