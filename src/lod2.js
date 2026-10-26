import * as THREE from 'three';
import { lonLatToWorld, WIENER_NULL } from './geo.js';

// Generalised roof model LOD2.1 (Stadt Wien, OGD CC BY 4.0), converted per 1:1000 map sheet by /api/lod2/:sheet.

let sheetIndex = null;
const sheetsReady = fetch('/data/sheets.json')
  .then((r) => r.json())
  .then((s) => (sheetIndex = s))
  .catch(() => (sheetIndex = []));

const cache = new Map(); // id -> Promise<Building[]>
const MAX_CACHED = 60;

function parse(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 28 || dv.getUint32(0, true) !== 0x3156324c) throw new Error('bad LOD2 sheet');
  const nb = dv.getUint32(4, true), nv = dv.getUint32(8, true);
  const lon0 = dv.getFloat64(12, true), lat0 = dv.getFloat64(20, true);
  const v = new Float32Array(buf, 28, nv * 3);
  // world coordinates
  const w = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const [x, z] = lonLatToWorld(lon0 + v[i * 3], lat0 + v[i * 3 + 1]);
    w[i * 3] = x;
    w[i * 3 + 1] = v[i * 3 + 2] + WIENER_NULL;
    w[i * 3 + 2] = z;
  }
  const t = new DataView(buf, 28 + nv * 12, nb * 16);
  const out = [];
  for (let i = 0; i < nb; i++) {
    const roofStart = t.getUint32(i * 16, true), wallStart = t.getUint32(i * 16 + 4, true), end = t.getUint32(i * 16 + 8, true);
    let cx = 0, cz = 0;
    for (let k = roofStart; k < wallStart; k++) (cx += w[k * 3]), (cz += w[k * 3 + 2]);
    const n = wallStart - roofStart || 1;
    out.push({ w, roofStart, wallStart, end, ground: t.getFloat32(i * 16 + 12, true) + WIENER_NULL, cx: cx / n, cz: cz / n });
  }
  return out;
}

function loadSheet(id, signal) {
  let p = cache.get(id);
  if (p) {
    cache.delete(id);
    cache.set(id, p); // LRU bump
    return p;
  }
  p = fetch(`/api/lod2/${id}`, { signal })
    .then((r) => {
      if (!r.ok) throw new Error(`lod2 ${id}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then(parse)
    .catch((e) => {
      cache.delete(id);
      throw e;
    });
  cache.set(id, p);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return p;
}

/** All LOD2 buildings of the sheets overlapping the lon/lat bbox [w, s, e, n]. */
export async function lod2Buildings(bbox, signal) {
  await sheetsReady;
  const [w, s, e, n] = bbox;
  const ids = sheetIndex.filter(([, sw, ss, se, sn]) => se >= w && sw <= e && sn >= s && ss <= n).map((r) => r[0]);
  const res = await Promise.all(ids.map((id) => loadSheet(id, signal).catch((err) => (console.warn(err), []))));
  return res.flat();
}

/**
 * Mesh + collision for LOD2 buildings whose roof centroid lies in the chunk, and a coverage test
 * (2 m raster of all LOD2 roofs touching the chunk) used to drop the older block-model parts they replace.
 */
export function buildLod2(buildings, b) {
  const pos = [], uv = [], prisms = [];
  let count = 0;
  const U = (x) => (x - b.xMin) / b.size, V = (z) => 1 - (z - b.zMin) / b.size;
  const CELL = 2, PAD = 60;
  const gw = Math.ceil((b.size + 2 * PAD) / CELL);
  const cover = new Uint8Array(gw * gw);
  const ox = b.xMin - PAD, oz = b.zMin - PAD;

  for (const bd of buildings) {
    const { w } = bd;
    if (bd.cx < ox || bd.cx > b.xMax + PAD || bd.cz < oz || bd.cz > b.zMax + PAD) continue;
    const mine = bd.cx >= b.xMin && bd.cx < b.xMax && bd.cz >= b.zMin && bd.cz < b.zMax;
    if (mine) count++;

    for (let k = bd.roofStart; k < bd.wallStart; k += 3) {
      const x0 = w[k * 3], y0 = w[k * 3 + 1], z0 = w[k * 3 + 2];
      const x1 = w[k * 3 + 3], y1 = w[k * 3 + 4], z1 = w[k * 3 + 5];
      const x2 = w[k * 3 + 6], y2 = w[k * 3 + 7], z2 = w[k * 3 + 8];
      // rasterise footprint coverage
      const minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2), minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2);
      const d = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
      if (Math.abs(d) > 1e-6) {
        for (let gz = Math.max(0, Math.floor((minZ - oz) / CELL)); gz <= Math.min(gw - 1, Math.floor((maxZ - oz) / CELL)); gz++)
          for (let gx = Math.max(0, Math.floor((minX - ox) / CELL)); gx <= Math.min(gw - 1, Math.floor((maxX - ox) / CELL)); gx++) {
            const px = ox + (gx + 0.5) * CELL, pz = oz + (gz + 0.5) * CELL;
            const a = ((x1 - px) * (z2 - pz) - (x2 - px) * (z1 - pz)) / d;
            const c = ((x2 - px) * (z0 - pz) - (x0 - px) * (z2 - pz)) / d;
            if (a >= -0.05 && c >= -0.05 && a + c <= 1.05) cover[gz * gw + gx] = 1;
          }
      }
      if (!mine) continue;
      pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      uv.push(U(x0), V(z0), U(x1), V(z1), U(x2), V(z2));
      // collision: prism from the ground up to the roof plane
      if (Math.abs(d) < 0.01) continue;
      // plane y = A x + B z + C through the three vertices
      const A = ((y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0)) / d;
      const B = ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / d;
      prisms.push({
        rings: [Float64Array.of(x0, z0, x1, z1, x2, z2)],
        minX, maxX, minZ, maxZ,
        bottom: bd.ground - 1,
        top: Math.max(y0, y1, y2),
        minTop: Math.min(y0, y1, y2),
        plane: [A, B, y0 - A * x0 - B * z0],
      });
    }
    if (!mine) continue;
    for (let k = bd.wallStart; k < bd.end; k++) {
      const x = w[k * 3], z = w[k * 3 + 2];
      pos.push(x, w[k * 3 + 1], z);
      uv.push(U(x), V(z));
    }
  }

  const covered = (x, z) => {
    const gx = Math.floor((x - ox) / CELL), gz = Math.floor((z - oz) / CELL);
    return gx >= 0 && gz >= 0 && gx < gw && gz < gw && cover[gz * gw + gx] === 1;
  };
  let geometry = null;
  if (pos.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
  }
  return { geometry, prisms, covered, count };
}
