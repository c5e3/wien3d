import * as THREE from 'three';
import { lonLatToWorld, worldToLonLat } from './geo.js';

// Street names from the Stadt Wien street graph (GIP), as flat white text boxes floating a set height above the
// terrain along the street. Loaded around the player; segments of a street are joined into chains, which get a
// label every SPACING m, kept straight, off buildings and clear of each other. The text turns in the shader so
// it never reads upside down.
const WFS =
  'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json&typeName=ogdwien:STRASSENGRAPHOGD';
const SPACING = 400; // m between labels along a street
const DEDUP = 150; // m: no second label of the same name this close (dual carriageways, crossings)
const STEP = 5; // m: terrain sample spacing along a label
const SLIDE = 8, SLIDE_MAX = 80; // m: a blocked label tries spots up to this far apart along its street, up to this far
const SHRINK = 0.8, MIN_H = 2; // a label that doesn't fit anywhere tries again this much smaller, down to this box height (m)
const BENT = 0.35; // share of the box height the street may bend away from the box
const MARGIN = 1.5; // m kept free between two labels
const CELL = 64; // m: spatial hash of placed labels
const RELAYOUT = 2; // s: at most this often re-place labels after buildings loaded
const PAGE = 2048; // atlas page size (px)
const FONT_PX = 32, ROW = 44, PAD = 14, GAP = 4; // text, box height, inner padding, gap between boxes
const FONT = `600 ${FONT_PX}px 'Open Sans Variable', 'Helvetica Neue', 'Segoe UI', sans-serif`;

// box height in m by functional road class (FRC 0 motorway ... 10 footpath)
const boxHeight = (frc) => (frc <= 2 ? 9 : frc <= 5 ? 7 : frc <= 7 ? 5.5 : 4);

// screen right on the ground, shared by every label material (see update)
const labelRight = { value: new THREE.Vector2(1, 0) };

function labelMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.labelRight = labelRight;
    s.vertexShader =
      'uniform vec2 labelRight;\nattribute vec4 aRect;\nattribute vec2 aDir;\n' +
      s.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        if (dot(aDir, labelRight) < 0.0) vMapUv = aRect.xy + aRect.zw - uv; // turn the text by 180°`
      );
  };
  return m;
}

/** Shelf-packs label boxes into atlas canvases; returns per name { page, rect, aspect }. */
function buildAtlas(names) {
  const pages = [], entries = new Map();
  let ctx = null, x = 0, y = 0;
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = c.height = PAGE;
    ctx = c.getContext('2d');
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    pages.push(c);
    x = y = 0;
  };
  newPage();
  for (const name of names) {
    const w = Math.min(PAGE - GAP, Math.ceil(ctx.measureText(name).width) + 2 * PAD);
    if (x + w + GAP > PAGE) (x = 0), (y += ROW + GAP);
    if (y + ROW + GAP > PAGE) newPage();
    const bx = x + GAP / 2, by = y + GAP / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, ROW, ROW * 0.3);
    ctx.fill();
    ctx.fillStyle = '#1f1f1f';
    ctx.fillText(name, bx + w / 2, by + ROW / 2 + 1, w - 2 * PAD);
    // u0, v0 (bottom), u1, v1 (top); canvas y runs down, the texture's v up
    entries.set(name, { page: pages.length - 1, rect: [bx / PAGE, 1 - (by + ROW) / PAGE, (bx + w) / PAGE, 1 - by / PAGE], aspect: w / ROW });
    x += w + GAP;
  }
  return { pages, entries };
}

/** Joins the segments of one street that share a graph node into polylines. */
function chains(segs) {
  const at = new Map();
  for (const s of segs) for (const n of [s.from, s.to]) (at.get(n) ?? at.set(n, []).get(n)).push(s);
  const out = [];
  for (const s of segs) {
    if (s.used) continue;
    s.used = true;
    const c = { pts: [...s.pts], frc: s.frc };
    let tail = s.to, head = s.from;
    for (let next; (next = at.get(tail).find((o) => !o.used)); ) {
      next.used = true;
      const fwd = next.from === tail;
      c.pts.push(...(fwd ? next.pts : [...next.pts].reverse()).slice(1));
      tail = fwd ? next.to : next.from;
      c.frc = Math.min(c.frc, next.frc);
    }
    for (let prev; (prev = at.get(head).find((o) => !o.used)); ) {
      prev.used = true;
      const fwd = prev.to === head;
      c.pts.unshift(...(fwd ? prev.pts : [...prev.pts].reverse()).slice(0, -1));
      head = fwd ? prev.from : prev.to;
      c.frc = Math.min(c.frc, prev.frc);
    }
    out.push(c);
  }
  return out;
}

/** Point at distance s along a polyline with cumulative lengths cum. */
function pointAt(pts, cum, s) {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}

/** Largest distance of the polyline between s0 and s1 from the straight line a-b (unit direction d). */
function bend(pts, cum, s0, s1, a, d) {
  let m = 0;
  for (let i = 0; i < pts.length; i++)
    if (cum[i] > s0 && cum[i] < s1) m = Math.max(m, Math.abs((pts[i][0] - a[0]) * d[1] - (pts[i][1] - a[1]) * d[0]));
  return m;
}

/** Oriented rectangles (centre, unit direction, half length / height) overlap, separating axis test. */
function overlaps(p, q) {
  const tx = q.cx - p.cx, tz = q.cz - p.cz;
  for (const [ux, uz] of [[p.dx, p.dz], [-p.dz, p.dx], [q.dx, q.dz], [-q.dz, q.dx]]) {
    const r = (o) => o.hl * Math.abs(o.dx * ux + o.dz * uz) + o.hh * Math.abs(-o.dz * ux + o.dx * uz);
    if (Math.abs(tx * ux + tz * uz) > r(p) + r(q)) return false;
  }
  return true;
}

export class StreetNames {
  constructor({ scene, terrain, player, chunks, renderer }) {
    this.scene = scene;
    this.terrain = terrain;
    this.player = player;
    this.chunks = chunks; // building footprints (chunks.collision) and their revision (chunks.rev)
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.range = 2600;
    this.hover = 1; // m above the terrain, settings.streetNamesHeight
    this.on = false;
    this.data = null; // { slots, pages }: the loaded streets, laid out again whenever buildings arrive
    this.meshes = [];
    this.center = null;
    this.t = 0;
    this.layoutT = 0;
  }

  radius() {
    return Math.min(this.range * 0.6, 1600); // flat text further away is unreadable anyway
  }

  setVisible(on) {
    if (this.on === on) return;
    this.on = on;
    if (on) this.load();
    else {
      this.abort?.abort();
      this.setData(null);
      this.center = null;
    }
  }

  /** Render distance in metres (fog end), see settings.range. */
  setRange(m) {
    if (this.range === m) return;
    this.range = m;
    if (this.on && this.center) this.load();
  }

  /** Height of the labels above the terrain in metres. */
  setHeight(m) {
    if (this.hover === m) return;
    this.hover = m;
    this.layout();
  }

  clearMeshes() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
  }

  setData(data) {
    this.clearMeshes();
    for (const p of this.data?.pages ?? []) {
      p.material.map.dispose();
      p.material.dispose();
    }
    this.data = data;
  }

  async load() {
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    const p = this.player.pos, r = this.radius();
    this.center = { x: p.x, z: p.z };
    const [lon, lat] = worldToLonLat(p.x, p.z);
    const dLat = r / 111320, dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
    try {
      const [j] = await Promise.all([
        fetch(`${WFS}&bbox=${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat},EPSG:4326`, { signal: abort.signal }).then((res) => res.json()),
        this.terrain.ensure({ xMin: p.x - r, xMax: p.x + r, zMin: p.z - r, zMax: p.z + r }),
        document.fonts.load(FONT),
      ]);
      if (abort.signal.aborted) return;
      this.setData(this.prepare(j.features || []));
      this.layout();
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('street names', e);
    }
  }

  /** Streets joined into chains and cut into label slots; one atlas texture per page. */
  prepare(features) {
    const byName = new Map();
    for (const f of features) {
      const name = f.properties.FEATURENAME?.trim(), g = f.geometry;
      if (!name || g?.type !== 'LineString' || g.coordinates.length < 2) continue;
      const seg = { pts: g.coordinates.map((c) => lonLatToWorld(c[0], c[1])), from: f.properties.NODEFROM_OBJECTID, to: f.properties.NODETO_OBJECTID, frc: f.properties.FRC ?? 10 };
      (byName.get(name) ?? byName.set(name, []).get(name)).push(seg);
    }
    const { pages, entries } = buildAtlas([...byName.keys()]);
    const slots = [];
    for (const [name, segs] of byName)
      for (const c of chains(segs)) {
        const cum = [0];
        for (let i = 1; i < c.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]));
        const chain = { ...c, cum, len: cum.at(-1), name, e: entries.get(name) };
        const n = Math.max(1, Math.floor(chain.len / SPACING));
        for (let i = 0; i < n; i++) slots.push({ chain, s: (chain.len * (i + 0.5)) / n, win: Math.min(SLIDE_MAX, chain.len / n / 2) });
      }
    // major roads and long streets choose their spots first
    slots.sort((a, b) => a.chain.frc - b.chain.frc || b.chain.len - a.chain.len);
    return {
      slots,
      pages: pages.map((canvas) => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.maxAniso;
        return { material: labelMaterial(tex) };
      }),
    };
  }

  /** Nearest spot to the slot that is straight enough, off buildings and clear of other labels, or null. */
  place(slot, grid, named) {
    const c = slot.chain, { pts, cum, e } = c;
    const H = boxHeight(c.frc);
    for (let h = H; h >= Math.min(H, MIN_H); h *= SHRINK) {
      const L = h * e.aspect, step = Math.min(SLIDE, L / 4); // finer steps for small labels on short streets
      if (c.len < L * 1.05) continue;
      for (let k = 0; k * step <= slot.win; k++)
        for (const sign of k ? [1, -1] : [1]) {
          const s = slot.s + sign * k * step;
          if (s - L / 2 < 0 || s + L / 2 > c.len) continue;
          const a = pointAt(pts, cum, s - L / 2), b = pointAt(pts, cum, s + L / 2);
          const dl = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (dl < L * 0.9) continue; // too curvy here
          const d = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
          if (bend(pts, cum, s - L / 2, s + L / 2, a, d) > h * BENT) continue;
          const r = { cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, dx: d[0], dz: d[1], hl: dl / 2, hh: h / 2, L: dl, h, e };
          if (named.get(c.name)?.some((q) => Math.hypot(q.cx - r.cx, q.cz - r.cz) < DEDUP)) return null;
          if (this.hitsLabel(r, grid) || this.hitsBuilding(r)) continue;
          return r;
        }
    }
    return null;
  }

  hitsLabel(r, grid) {
    const grow = (o) => ({ ...o, hl: o.hl + MARGIN / 2, hh: o.hh + MARGIN / 2 });
    const p = grow(r), R = Math.hypot(p.hl, p.hh);
    for (let ix = Math.floor((r.cx - R) / CELL); ix <= Math.floor((r.cx + R) / CELL); ix++)
      for (let iz = Math.floor((r.cz - R) / CELL); iz <= Math.floor((r.cz + R) / CELL); iz++)
        for (const q of grid.get(`${ix},${iz}`) ?? []) if (overlaps(p, grow(q))) return true;
    return false;
  }

  /** The box, as a row of circles along it, cuts through a building (not one passing above or ending below it). */
  hitsBuilding(r) {
    const rad = r.hh * 0.9, n = Math.max(1, Math.ceil((r.L - 2 * rad) / rad));
    for (let i = 0; i <= n; i++) {
      const t = -r.hl + rad + ((r.L - 2 * rad) * i) / n;
      const x = r.cx + r.dx * t, z = r.cz + r.dz * t;
      const g = this.terrain.heightAt(x, z) ?? 170;
      const y = g + this.hover;
      if (this.chunks.collision.query(x, z, rad).some((p) => p.bottom < y + 2 && p.top > y - 0.5)) return true;
    }
    return false;
  }

  layout() {
    if (!this.data) return;
    this.layoutRev = this.chunks.rev;
    const { slots, pages } = this.data;
    const grid = new Map(), named = new Map(), labels = [];
    for (const slot of slots) {
      const r = this.place(slot, grid, named);
      if (!r) continue;
      labels.push(r);
      (named.get(slot.chain.name) ?? named.set(slot.chain.name, []).get(slot.chain.name)).push(r);
      const R = Math.hypot(r.hl, r.hh) + MARGIN;
      for (let ix = Math.floor((r.cx - R) / CELL); ix <= Math.floor((r.cx + R) / CELL); ix++)
        for (let iz = Math.floor((r.cz - R) / CELL); iz <= Math.floor((r.cz + R) / CELL); iz++) {
          const k = `${ix},${iz}`;
          (grid.get(k) ?? grid.set(k, []).get(k)).push(r);
        }
    }

    // one mesh per atlas page: a strip per label, every vertex on the terrain + hover
    const geo = pages.map(() => ({ pos: [], uv: [], rect: [], dir: [], idx: [] }));
    for (const { cx, cz, dx, dz, L, h, e } of labels) {
      const g = geo[e.page], [u0, v0, u1, v1] = e.rect;
      const nx = dz, nz = -dx; // towards the text's top: away from a camera whose screen right is (dx, dz)
      const k = Math.max(1, Math.ceil(L / STEP)), base = g.pos.length / 3;
      for (let i = 0; i <= k; i++) {
        const t = i / k, px = cx + dx * (t - 0.5) * L, pz = cz + dz * (t - 0.5) * L;
        for (const [side, v] of [[-0.5, v0], [0.5, v1]]) {
          const x = px + nx * side * h, z = pz + nz * side * h;
          g.pos.push(x, (this.terrain.heightAt(x, z) ?? 170) + this.hover, z);
          g.uv.push(u0 + (u1 - u0) * t, v);
          g.rect.push(u0, v0, u1, v1);
          g.dir.push(dx, dz);
        }
        if (i) {
          const q = base + (i - 1) * 2;
          g.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
    }

    this.clearMeshes();
    pages.forEach((page, i) => {
      const g = geo[i];
      if (!g.idx.length) return;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      bg.setAttribute('aRect', new THREE.Float32BufferAttribute(g.rect, 4));
      bg.setAttribute('aDir', new THREE.Float32BufferAttribute(g.dir, 2));
      bg.setIndex(g.idx);
      bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, page.material);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    });
  }

  update(dt, camera) {
    if (!this.on) return;
    // screen right projected onto the ground (first column of the camera's world matrix)
    const m = camera.matrixWorld.elements;
    if (Math.hypot(m[0], m[2]) > 1e-3) labelRight.value.set(m[0], m[2]);
    this.t += dt;
    this.layoutT += dt;
    if (this.t < 1) return;
    this.t = 0;
    const p = this.player.pos;
    if (this.center && Math.hypot(p.x - this.center.x, p.z - this.center.z) > this.radius() * 0.4) this.load();
    // buildings were loaded or unloaded: place the labels around them again
    else if (this.data && this.chunks.rev !== this.layoutRev && this.layoutT >= RELAYOUT) {
      this.layoutT = 0;
      this.layout();
    }
  }
}
