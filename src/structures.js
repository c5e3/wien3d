import * as THREE from 'three';
import { lonLatToWorld } from './geo.js';

// Bridges & tunnels of MA 29, ASFINAG and Wiener Linien, preprocessed by scripts/build-structures.mjs.
// Per vertex: bridge a = deck top, b = deck underside; tunnel a = floor, b = roof (terrain) top, c = clear height.

let list = [];
export const structuresReady = fetch('/data/structures.json')
  .then((r) => r.json())
  .then((j) => (list = j.structures.map(prepare)))
  .catch((e) => console.warn('structures', e));

function prepare(s) {
  const n = s.v.length / 4;
  const x = new Float64Array(n), z = new Float64Array(n), a = new Float32Array(n), b = new Float32Array(n);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    [x[i], z[i]] = lonLatToWorld(s.v[i * 4], s.v[i * 4 + 1]);
    a[i] = s.v[i * 4 + 2];
    b[i] = s.v[i * 4 + 3];
    minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
    minZ = Math.min(minZ, z[i]); maxZ = Math.max(maxZ, z[i]);
  }
  const rings = [];
  let start = 0;
  for (const end of s.r) rings.push([start, end]), (start = end);

  // bridge axis (for pier orientation)
  let ang = 0;
  if (s.piers?.length) {
    let mx = 0, mz = 0, xx = 0, xz = 0, zz = 0;
    for (let i = 0; i < n; i++) (mx += x[i]), (mz += z[i]);
    mx /= n; mz /= n;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - mx, dz = z[i] - mz;
      xx += dx * dx; xz += dx * dz; zz += dz * dz;
    }
    ang = 0.5 * Math.atan2(2 * xz, xx - zz);
  }
  const piers = (s.piers || []).map(([lon, lat, top, w, d]) => {
    const [px, pz] = lonLatToWorld(lon, lat);
    return { x: px, z: pz, top, w, d };
  });
  return { name: s.n, op: s.op, kind: s.k, clear: s.c, open: new Set(s.open || []), tris: s.t, x, z, a, b, rings, piers, ang, minX, maxX, minZ, maxZ };
}

const overlaps = (s, bd, pad = 0) => s.maxX >= bd.xMin - pad && s.minX <= bd.xMax + pad && s.maxZ >= bd.zMin - pad && s.minZ <= bd.zMax + pad;

/** Tunnel footprints touching the bounds, as polygon-clipping polygons ([[x,z],...] rings). */
export function tunnelPolygons(bd) {
  return list
    .filter((s) => s.kind === 't' && overlaps(s, bd, 10))
    .map((s) => ({ s, poly: s.rings.map(([i0, i1]) => { const r = []; for (let i = i0; i < i1; i++) r.push([s.x[i], s.z[i]]); r.push(r[0]); return r; }) }));
}

const COL_CONCRETE = new THREE.Color(0xb9b4aa);
const COL_UNDER = new THREE.Color(0x8d8880);
const COL_FLOOR = new THREE.Color(0x4a4a4c);
const COL_TUNNEL = new THREE.Color(0xa29d92);
export const sideMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/**
 * Geometry + collision for every structure part inside chunk bounds.
 * Triangles/edges are assigned to the chunk containing their centre so long bridges split cleanly.
 */
export function buildStructures(bd, terrain) {
  const top = { pos: [], uv: [] };
  const side = { pos: [], col: [] };
  const prisms = [];
  const inChunk = (x, z) => x >= bd.xMin && x < bd.xMax && z >= bd.zMin && z < bd.zMax;
  const U = (x) => (x - bd.xMin) / bd.size, V = (z) => 1 - (z - bd.zMin) / bd.size;
  const topTri = (x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
    top.pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    top.uv.push(U(x0), V(z0), U(x1), V(z1), U(x2), V(z2));
  };
  const sideTri = (c, x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
    side.pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    for (let i = 0; i < 3; i++) side.col.push(c.r, c.g, c.b);
  };
  const sideQuad = (c, ax, az, a0, a1, bx, bz, b0, b1) => {
    sideTri(c, ax, a0, az, bx, b0, bz, bx, b1, bz);
    sideTri(c, ax, a0, az, bx, b1, bz, ax, a1, az);
  };
  const triPrism = (s, i, j, k, bottom, topH) =>
    prisms.push({
      rings: [Float64Array.of(s.x[i], s.z[i], s.x[j], s.z[j], s.x[k], s.z[k])],
      minX: Math.min(s.x[i], s.x[j], s.x[k]), maxX: Math.max(s.x[i], s.x[j], s.x[k]),
      minZ: Math.min(s.z[i], s.z[j], s.z[k]), maxZ: Math.max(s.z[i], s.z[j], s.z[k]),
      bottom, top: topH,
    });
  const rectPrism = (cx, cz, ux, uz, hl, hw, bottom, topH) => {
    // oriented rectangle: half length hl along (ux,uz), half width hw across
    const px = -uz, pz = ux;
    const r = Float64Array.of(
      cx + ux * hl + px * hw, cz + uz * hl + pz * hw, cx - ux * hl + px * hw, cz - uz * hl + pz * hw,
      cx - ux * hl - px * hw, cz - uz * hl - pz * hw, cx + ux * hl - px * hw, cz + uz * hl - pz * hw
    );
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i += 2) (minX = Math.min(minX, r[i])), (maxX = Math.max(maxX, r[i])), (minZ = Math.min(minZ, r[i + 1])), (maxZ = Math.max(maxZ, r[i + 1]));
    prisms.push({ rings: [r], minX, maxX, minZ, maxZ, bottom, top: topH });
    return r;
  };

  for (const s of list) {
    if (!overlaps(s, bd)) continue;
    const { x, z, a, b, tris } = s;
    const tunnel = s.kind === 't';

    // horizontal surfaces
    for (let t = 0; t < tris.length; t += 3) {
      const i = tris[t], j = tris[t + 1], k = tris[t + 2];
      if (!inChunk((x[i] + x[j] + x[k]) / 3, (z[i] + z[j] + z[k]) / 3)) continue;
      if (!tunnel) {
        topTri(x[i], a[i], z[i], x[j], a[j], z[j], x[k], a[k], z[k]);
        sideTri(COL_UNDER, x[k], b[k], z[k], x[j], b[j], z[j], x[i], b[i], z[i]);
        triPrism(s, i, j, k, (b[i] + b[j] + b[k]) / 3, (a[i] + a[j] + a[k]) / 3);
      } else {
        const c = s.clear;
        topTri(x[i], b[i], z[i], x[j], b[j], z[j], x[k], b[k], z[k]); // roof = ground surface
        sideTri(COL_FLOOR, x[i], a[i], z[i], x[j], a[j], z[j], x[k], a[k], z[k]);
        sideTri(COL_TUNNEL, x[k], a[k] + c, z[k], x[j], a[j] + c, z[j], x[i], a[i] + c, z[i]);
        const fa = (a[i] + a[j] + a[k]) / 3;
        triPrism(s, i, j, k, fa - 3, fa);
        triPrism(s, i, j, k, fa + c, (b[i] + b[j] + b[k]) / 3);
      }
    }

    // vertical edges
    for (const [i0, i1] of s.rings)
      for (let i = i0; i < i1; i++) {
        const j = i + 1 < i1 ? i + 1 : i0;
        const mx = (x[i] + x[j]) / 2, mz = (z[i] + z[j]) / 2;
        if (!inChunk(mx, mz)) continue;
        if (!tunnel) {
          sideQuad(COL_CONCRETE, x[i], z[i], b[i], a[i], x[j], z[j], b[j], a[j]);
        } else {
          const open = s.open.has(i);
          const lo = open ? s.clear : 0;
          sideQuad(COL_TUNNEL, x[i], z[i], a[i] + lo, b[i], x[j], z[j], a[j] + lo, b[j]);
          const len = Math.hypot(x[j] - x[i], z[j] - z[i]);
          if (len > 0.01) {
            const fa = Math.min(a[i], a[j]);
            rectPrism(mx, mz, (x[j] - x[i]) / len, (z[j] - z[i]) / len, len / 2, 0.2, open ? fa + s.clear : fa - 3, Math.max(b[i], b[j]));
          }
        }
      }

    // tunnels hollow out the terrain for collision
    if (tunnel) {
      for (const [i0, i1] of s.rings.slice(0, 1)) {
        const r = new Float64Array((i1 - i0) * 2);
        for (let i = i0; i < i1; i++) (r[(i - i0) * 2] = x[i]), (r[(i - i0) * 2 + 1] = z[i]);
        let hi = -Infinity;
        for (let i = i0; i < i1; i++) hi = Math.max(hi, b[i]);
        prisms.push({ void: true, rings: [r], minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ, bottom: -Infinity, top: hi });
      }
    }

    // piers
    const ux = Math.cos(s.ang), uz = Math.sin(s.ang);
    for (const p of s.piers) {
      if (!inChunk(p.x, p.z)) continue;
      const g = terrain.heightAt(p.x, p.z);
      if (g === null) continue;
      // pier: depth d along the bridge axis, width w across it
      const r = rectPrism(p.x, p.z, ux, uz, p.d / 2, p.w / 2, g - 2, p.top);
      for (let q = 0; q < 4; q++) {
        const n = (q + 1) % 4;
        sideQuad(COL_CONCRETE, r[q * 2], r[q * 2 + 1], g - 2, p.top, r[n * 2], r[n * 2 + 1], g - 2, p.top);
      }
    }
  }

  const geo = (pos, attr, name, size) => {
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute(name, new THREE.Float32BufferAttribute(attr, size));
    g.computeVertexNormals();
    return g;
  };
  return { top: geo(top.pos, top.uv, 'uv', 2), side: geo(side.pos, side.col, 'color', 3), prisms };
}
