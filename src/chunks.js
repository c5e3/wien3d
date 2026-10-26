import * as THREE from 'three';
import { tileBounds, tileLonLatBBox, worldToTile } from './geo.js';
import { fetchWfs, buildBuildings, buildTrees } from './buildings.js';
import { structuresReady, buildStructures, tunnelPolygons, sideMaterial } from './structures.js';
import polygonClipping from 'polygon-clipping';
import { lod2Buildings, buildLod2 } from './lod2.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// BVH-accelerated raycasting for picking on the big merged meshes
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
function pickable(mesh, kind) {
  mesh.geometry.computeBoundsTree();
  mesh.userData.pick = kind;
  return mesh;
}

// A chunk is one z16 web-mercator tile (~407 m wide in Vienna).
export const CZ = 16;
const R_TERRAIN = 6; // chunks of ground around the player
const R_BUILDINGS = 3;
const GROUND_SEG = 48;

// basemap.at orthophoto (free, no key)
const ORTHO = (z, x, y) => `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`;
const orthoZoomFor = (d) => (d <= 2 ? 18 : d <= 4 ? 17 : 16);

class Scheduler {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.tasks = [];
  }
  get pending() {
    return this.tasks.length + this.active;
  }
  add(chunk, run) {
    this.tasks.push({ chunk, run });
    this.pump();
  }
  pump() {
    while (this.active < this.limit) {
      this.tasks = this.tasks.filter((t) => !t.chunk.disposed);
      if (!this.tasks.length) return;
      let bi = 0;
      for (let i = 1; i < this.tasks.length; i++) if (this.tasks[i].chunk.dist < this.tasks[bi].chunk.dist) bi = i;
      const t = this.tasks.splice(bi, 1)[0];
      this.active++;
      t.run()
        .catch((e) => {
          if (e.name !== 'AbortError') console.warn(e);
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

async function loadImage(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return createImageBitmap(await r.blob());
}

/**
 * Remove tunnel footprints from the ground grid so tunnels can be entered.
 * Triangles touching a tunnel are clipped exactly; height and uv come from the original triangle's plane.
 */
function cutTunnels(pos, uv, idx, b) {
  const tunnels = tunnelPolygons(b);
  if (!tunnels.length) return { pos, uv, idx };
  const P = Array.from(pos), UV = Array.from(uv), out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const v = tri.map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
    const minX = Math.min(v[0][0], v[1][0], v[2][0]), maxX = Math.max(v[0][0], v[1][0], v[2][0]);
    const minZ = Math.min(v[0][2], v[1][2], v[2][2]), maxZ = Math.max(v[0][2], v[1][2], v[2][2]);
    const hits = tunnels.filter(({ s }) => s.maxX >= minX && s.minX <= maxX && s.maxZ >= minZ && s.minZ <= maxZ);
    let res = null;
    if (hits.length) {
      try {
        res = polygonClipping.difference([[...v.map((p) => [p[0], p[2]]), [v[0][0], v[0][2]]]], ...hits.map((h) => h.poly));
      } catch (e) {
        console.warn('tunnel cut failed', e);
      }
    }
    if (!res) {
      out.push(...tri);
      continue;
    }
    // barycentric interpolation on the original triangle
    const [A, B, C] = v;
    const det = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    for (const poly of res) {
      const rings = poly.map((r) => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
      const base = P.length / 3;
      for (const p of rings.flat()) {
        const l1 = ((B[2] - C[2]) * (p.x - C[0]) + (C[0] - B[0]) * (p.y - C[2])) / det;
        const l2 = ((C[2] - A[2]) * (p.x - C[0]) + (A[0] - C[0]) * (p.y - C[2])) / det;
        const l3 = 1 - l1 - l2;
        P.push(p.x, l1 * A[1] + l2 * B[1] + l3 * C[1], p.y);
        for (let c = 0; c < 2; c++) UV.push(l1 * UV[tri[0] * 2 + c] + l2 * UV[tri[1] * 2 + c] + l3 * UV[tri[2] * 2 + c]);
      }
      for (const f of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) out.push(base + f[0], base + f[1], base + f[2]);
    }
  }
  return { pos: P, uv: UV, idx: out };
}

class Chunk {
  constructor(mgr, x, y) {
    this.mgr = mgr;
    this.x = x;
    this.y = y;
    this.b = tileBounds(CZ, x, y);
    this.dist = 0;
    this.disposed = false;
    this.abort = new AbortController();
    this.group = new THREE.Group();
    this.material = new THREE.MeshLambertMaterial({ color: 0x8a8f86, side: THREE.DoubleSide });
    this.textures = new Map(); // zoom -> texture
    this.texLoading = new Set();
    this.prisms = [];
    this.groundReq = false;
    this.buildReq = false;
    mgr.scene.add(this.group);
  }

  sync() {
    const m = this.mgr;
    if (!this.groundReq) {
      this.groundReq = true;
      m.sGround.add(this, () => this.loadGround());
    }
    const want = orthoZoomFor(this.dist);
    for (const z of [CZ, want]) {
      if (!this.textures.has(z) && !this.texLoading.has(z)) {
        this.texLoading.add(z);
        m.sTex.add(this, () => this.loadTexture(z));
      }
    }
    // drop textures that are clearly too detailed now (with hysteresis)
    const keep = orthoZoomFor(Math.max(0, this.dist - 1));
    for (const [z, t] of this.textures)
      if (z > keep) {
        t.dispose();
        this.textures.delete(z);
        this.applyTexture();
      }
    if (this.dist <= R_BUILDINGS && !this.buildReq) {
      this.buildReq = true;
      m.sNet.add(this, () => this.loadBuildings());
    }
  }

  async loadGround() {
    await Promise.all([this.mgr.terrain.ensure(this.b), structuresReady]);
    if (this.disposed) return;
    const { xMin, zMin, size } = this.b;
    const n = GROUND_SEG + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = xMin + (i / GROUND_SEG) * size, z = zMin + (j / GROUND_SEG) * size;
        pos[k * 3] = x;
        pos[k * 3 + 1] = this.mgr.terrain.heightAt(x, z) ?? 170;
        pos[k * 3 + 2] = z;
        uv[k * 2] = i / GROUND_SEG;
        uv[k * 2 + 1] = 1 - j / GROUND_SEG;
      }
    const idx = [];
    for (let j = 0; j < GROUND_SEG; j++)
      for (let i = 0; i < GROUND_SEG; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    const cut = cutTunnels(pos, uv, idx, this.b);
    g.setAttribute('position', new THREE.Float32BufferAttribute(cut.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(cut.uv, 2));
    g.setIndex(cut.idx);
    g.computeVertexNormals();
    this.ground = new THREE.Mesh(g, this.material);
    this.ground.userData.pick = 'ground';
    this.group.add(this.ground);
  }

  async loadTexture(z) {
    try {
      const f = 2 ** (z - CZ);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256 * f;
      const ctx = canvas.getContext('2d');
      const jobs = [];
      for (let j = 0; j < f; j++)
        for (let i = 0; i < f; i++)
          jobs.push(
            loadImage(ORTHO(z, this.x * f + i, this.y * f + j), this.abort.signal)
              .then((img) => ctx.drawImage(img, i * 256, j * 256))
              .catch((e) => {
                if (e.name === 'AbortError') throw e;
              })
          );
      await Promise.all(jobs);
      if (this.disposed) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.mgr.maxAniso;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      this.textures.set(z, tex);
      this.applyTexture();
    } finally {
      this.texLoading.delete(z);
    }
  }

  applyTexture() {
    let best = null, bz = -1;
    for (const [z, t] of this.textures) if (z > bz) (bz = z), (best = t);
    if (this.material.map === best) return;
    this.material.map = best;
    this.material.color.set(best ? 0xffffff : 0x8a8f86);
    this.material.needsUpdate = true;
  }

  async loadBuildings() {
    const bbox = tileLonLatBBox(CZ, this.x, this.y);
    const signal = this.abort.signal;
    const [bk, trees, l2] = await Promise.all([
      fetchWfs('ogdwien:FMZKBKMOGD', 'O_KOTE,U_KOTE,T_KOTE,SHAPE', bbox, signal),
      fetchWfs('ogdwien:BAUMKATOGD', null, bbox, signal).catch(() => []),
      lod2Buildings(bbox, signal).catch(() => []),
      this.mgr.terrain.ensure(this.b),
    ]);
    if (this.disposed) return;
    const lod2 = buildLod2(l2, this.b);
    if (lod2.geometry) this.group.add((this.lod2 = pickable(new THREE.Mesh(lod2.geometry, this.material), 'building')));
    const { geometry, prisms, count } = buildBuildings(bk, this.b, this.mgr.terrain, lod2.covered);
    this.count = count + lod2.count;
    prisms.push(...lod2.prisms);
    await structuresReady;
    if (this.disposed) return;
    const st = buildStructures(this.b, this.mgr.terrain);
    if (st.top) this.group.add((this.structTop = pickable(new THREE.Mesh(st.top, this.material), 'structure')));
    if (st.side) this.group.add((this.structSide = pickable(new THREE.Mesh(st.side, sideMaterial), 'structure')));
    prisms.push(...st.prisms);
    if (geometry) {
      this.buildings = pickable(new THREE.Mesh(geometry, this.material), 'building');
      this.group.add(this.buildings);
    }
    this.prisms = prisms;
    this.mgr.collision.add(prisms);
    this.trees = buildTrees(trees, this.b, this.mgr.terrain);
    if (this.trees) this.group.add(this.trees);
    this.mgr.stats.buildings += this.count;
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.mgr.scene.remove(this.group);
    this.ground?.geometry.dispose();
    this.buildings?.geometry.dispose();
    this.structTop?.geometry.dispose();
    this.lod2?.geometry.dispose();
    this.structSide?.geometry.dispose();
    this.trees?.userData.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.material.dispose();
    this.mgr.collision.remove(this.prisms);
    this.mgr.stats.buildings -= this.count || 0;
  }
}

export class ChunkManager {
  constructor({ scene, terrain, collision, renderer }) {
    this.scene = scene;
    this.terrain = terrain;
    this.collision = collision;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.chunks = new Map();
    this.sGround = new Scheduler(4);
    this.sTex = new Scheduler(6);
    this.sNet = new Scheduler(3);
    this.stats = { buildings: 0 };
    this.center = null;
    // offsets sorted by distance so near chunks get created first
    this.offsets = [];
    for (let dy = -R_TERRAIN; dy <= R_TERRAIN; dy++)
      for (let dx = -R_TERRAIN; dx <= R_TERRAIN; dx++) this.offsets.push([dx, dy]);
    this.offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  }

  get pending() {
    return this.sGround.pending + this.sTex.pending + this.sNet.pending;
  }

  update(pos) {
    const [fx, fy] = worldToTile(CZ, pos.x, pos.z);
    const cx = Math.floor(fx), cy = Math.floor(fy);
    const key = `${cx},${cy}`;
    if (this.center === key) return;
    this.center = key;

    for (const [dx, dy] of this.offsets) {
      const x = cx + dx, y = cy + dy, k = `${x},${y}`;
      let c = this.chunks.get(k);
      if (!c) this.chunks.set(k, (c = new Chunk(this, x, y)));
    }
    for (const [k, c] of this.chunks) {
      c.dist = Math.max(Math.abs(c.x - cx), Math.abs(c.y - cy));
      if (c.dist > R_TERRAIN + 1) {
        c.dispose();
        this.chunks.delete(k);
      } else c.sync();
    }
  }
}
