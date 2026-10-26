// Converts one sheet of Vienna's generalised roof model (LOD2.1, CityGML, OGD CC BY 4.0)
// into a compact gzipped binary of triangulated roofs and walls.
// Used by the Vercel function (api/lod2/[sheet].js) and the Vite dev server (vite.config.js).
//
// Binary layout (little endian):
//   char[4] 'L2V1' | u32 buildingCount | u32 vertexCount | f64 lon0 | f64 lat0
//   f32 vertices[vertexCount * 3]   (lon - lon0, lat - lat0, height above Wiener Null), triangle soup
//   per building: u32 roofStart, u32 wallStart, u32 end (vertex indices), f32 groundHeight

import { unzipSync, gzipSync } from 'fflate';
import proj4 from 'proj4';
import earcut from 'earcut';

const SOURCE = (id) => `https://www.wien.gv.at/ma41datenviewer/downloads/geodaten/lod2_gml/${id}_lod2_gml.zip`;
export const SHEET_RE = /^\d{6}$/;

proj4.defs('EPSG:31256', '+proj=tmerc +lat_0=0 +lon_0=16.33333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs');
const toWgs = proj4('EPSG:31256', 'EPSG:4326');

const parseRing = (s) => {
  const n = s.trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i + 2 < n.length; i += 3) pts.push([n[i], n[i + 1], n[i + 2]]);
  const a = pts[0], z = pts[pts.length - 1];
  if (pts.length > 1 && a[0] === z[0] && a[1] === z[1] && a[2] === z[2]) pts.pop();
  return pts;
};

/** Triangulate a planar 3D polygon (outer ring + holes); returns a flat list of [x,y,z] triangles. */
function triangulate(rings) {
  const outer = rings[0];
  // Newell normal -> drop the dominant axis
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < outer.length; i++) {
    const [x1, y1, z1] = outer[i], [x2, y2, z2] = outer[(i + 1) % outer.length];
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2];
  const flat = [], holes = [], all = [];
  for (const r of rings) {
    if (r !== outer) holes.push(all.length);
    for (const p of r) flat.push(p[u], p[v]), all.push(p);
  }
  const idx = earcut(flat, holes.length ? holes : null, 2);
  return idx.map((i) => all[i]);
}

export function convertGml(xml) {
  const buildings = [];
  const proj = new Map();
  const ll = (p) => {
    const k = `${p[0]},${p[1]}`;
    let r = proj.get(k);
    if (!r) proj.set(k, (r = toWgs.forward([p[0], p[1]])));
    return r;
  };

  for (const member of xml.split('<core:cityObjectMember>').slice(1)) {
    const roofs = [], walls = [];
    let ground = Infinity;
    const g = /name="HoeheGrund">\s*<gen:value>([^<]+)</.exec(member);
    if (g) ground = parseFloat(g[1]);
    const surfRe = /<bldg:(RoofSurface|WallSurface|GroundSurface)\b[\s\S]*?<\/bldg:\1>/g;
    let sm;
    while ((sm = surfRe.exec(member))) {
      const kind = sm[1];
      const polyRe = /<gml:Polygon\b[\s\S]*?<\/gml:Polygon>/g;
      let pm;
      while ((pm = polyRe.exec(sm[0]))) {
        const rings = [];
        const ringRe = /<gml:(exterior|interior)>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/g;
        let rm;
        while ((rm = ringRe.exec(pm[0]))) {
          const r = parseRing(rm[2]);
          if (r.length >= 3) rings.push(r);
        }
        if (!rings.length) continue;
        if (kind === 'GroundSurface') {
          for (const p of rings[0]) ground = Math.min(ground, p[2]);
          continue;
        }
        const tris = triangulate(rings);
        (kind === 'RoofSurface' ? roofs : walls).push(...tris);
      }
    }
    if (!roofs.length) continue;
    if (!Number.isFinite(ground)) ground = Math.min(...walls.concat(roofs).map((p) => p[2]));
    buildings.push({ roofs, walls, ground });
  }

  // assemble binary
  let nv = 0, lonSum = 0, latSum = 0;
  for (const b of buildings) nv += b.roofs.length + b.walls.length;
  const verts = new Float32Array(nv * 3);
  const table = new DataView(new ArrayBuffer(buildings.length * 16));
  const lls = [];
  for (const b of buildings) for (const p of b.roofs.concat(b.walls)) { const q = ll(p); lls.push(q); lonSum += q[0]; latSum += q[1]; }
  const lon0 = nv ? lonSum / nv : 0, lat0 = nv ? latSum / nv : 0;
  let vi = 0, k = 0;
  buildings.forEach((b, i) => {
    const roofStart = vi;
    for (const p of b.roofs) { const q = lls[k++]; verts[vi * 3] = q[0] - lon0; verts[vi * 3 + 1] = q[1] - lat0; verts[vi * 3 + 2] = p[2]; vi++; }
    const wallStart = vi;
    for (const p of b.walls) { const q = lls[k++]; verts[vi * 3] = q[0] - lon0; verts[vi * 3 + 1] = q[1] - lat0; verts[vi * 3 + 2] = p[2]; vi++; }
    table.setUint32(i * 16, roofStart, true);
    table.setUint32(i * 16 + 4, wallStart, true);
    table.setUint32(i * 16 + 8, vi, true);
    table.setFloat32(i * 16 + 12, b.ground, true);
  });
  const head = new DataView(new ArrayBuffer(28));
  [76, 50, 86, 49].forEach((c, i) => head.setUint8(i, c)); // 'L2V1'
  head.setUint32(4, buildings.length, true);
  head.setUint32(8, nv, true);
  head.setFloat64(12, lon0, true);
  head.setFloat64(20, lat0, true);
  const out = new Uint8Array(28 + verts.byteLength + table.byteLength);
  out.set(new Uint8Array(head.buffer), 0);
  out.set(new Uint8Array(verts.buffer), 28);
  out.set(new Uint8Array(table.buffer), 28 + verts.byteLength);
  return out;
}

/** Download + convert one sheet. Returns gzipped bytes (an empty model if the sheet has no data). */
export async function convertSheet(id) {
  if (!SHEET_RE.test(id)) throw new Error('bad sheet id');
  const r = await fetch(SOURCE(id));
  let bin;
  if (r.status === 404) bin = convertGml('');
  else if (!r.ok) throw new Error(`upstream ${r.status}`);
  else {
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const name = Object.keys(files).find((f) => f.toLowerCase().endsWith('.gml'));
    bin = convertGml(name ? new TextDecoder().decode(files[name]) : '');
  }
  return gzipSync(bin, { level: 6 });
}
