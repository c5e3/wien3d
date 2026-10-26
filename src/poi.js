import * as THREE from 'three';
import { lonLatToWorld, worldToLonLat } from './geo.js';

// Every point layer of the Stadt Wien WFS (index: scripts/build-poi-layers.mjs), shown as floating pins.
const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json';
const BIG = 5000; // larger layers are loaded around the player only
const RADIUS = 2000; // m
const HOVER = 30; // pin tip height above ground (m), joined to the ground by a faint line
const PIN_PX = 46; // point sprite size; the pin itself fills the upper half (tip = anchor)

function pinTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // pin occupies the upper half so its tip sits exactly on the point position
  g.beginPath();
  g.moveTo(32, 32);
  g.bezierCurveTo(26, 22, 18, 18, 18, 12);
  g.arc(32, 12, 14, Math.PI, 0);
  g.bezierCurveTo(46, 18, 38, 22, 32, 32);
  g.fillStyle = '#fff';
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.stroke();
  g.beginPath();
  g.arc(32, 12, 5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_DIST = 2600; // = fog far: beyond it pins would be fully fogged anyway

// screen size factor by distance; must match the shader below
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pinScale = (d) => (d > MAX_DIST ? 0 : 1 - 0.55 * smooth(150, MAX_DIST, d));

// fixed-pixel pins, depth tested (hidden behind buildings), fogged like the map, shrinking with distance
function pinMaterial(map, color) {
  const m = new THREE.PointsMaterial({ size: PIN_PX, sizeAttenuation: false, map, color, alphaTest: 0.5, fog: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      'gl_PointSize = size;',
      `float pinDist = length(mvPosition.xyz);
      gl_PointSize = pinDist > ${MAX_DIST.toFixed(1)} ? 0.0 : size * mix(1.0, 0.45, smoothstep(150.0, ${MAX_DIST.toFixed(1)}, pinDist));`
    );
  };
  return m;
}

const colorFor = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.75, 0.55);
};

export function featureLabel(props, layer) {
  if (layer?.label && props[layer.label]) return String(props[layer.label]);
  for (const [k, v] of Object.entries(props))
    if (typeof v === 'string' && v.length > 1 && v.length < 80 && !/ID$|^SE_|LINK|URL|DATUM|ZEIT/.test(k) && !/^https?:/.test(v)) return v;
  return layer?.title || 'POI';
}

export class PoiManager {
  constructor({ scene, terrain, player }) {
    this.scene = scene;
    this.terrain = terrain;
    this.player = player;
    this.layers = [];
    this.active = new Map();
    this.tex = pinTexture();
    this.fixT = 0;
    this.ready = fetch('/data/poi-layers.json')
      .then((r) => r.json())
      .then((l) => (this.layers = l))
      .catch(() => {});

    this.panel = document.getElementById('poi-panel');
    this.list = document.getElementById('poi-list');
    this.search = document.getElementById('poi-search');
    this.search.addEventListener('input', () => this.renderList());
    document.getElementById('poi-clear').addEventListener('click', () => {
      for (const id of [...this.active.keys()]) this.toggle(id, false);
      this.renderList();
    });
    this.list.addEventListener('change', (e) => {
      const id = e.target.dataset?.id;
      if (id) this.toggle(id, e.target.checked);
    });
  }

  get open() {
    return !this.panel.classList.contains('hidden');
  }

  async show() {
    await this.ready;
    this.panel.classList.remove('hidden');
    this.renderList();
    this.search.focus();
  }

  hide() {
    this.panel.classList.add('hidden');
    this.search.blur();
  }

  renderList() {
    const q = this.search.value.trim().toLowerCase();
    const rows = this.layers.filter((l) => !q || l.title.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
    this.list.innerHTML = rows
      .map((l) => {
        const a = this.active.get(l.id);
        const col = '#' + colorFor(l.id).getHexString();
        const status = a ? (a.loading ? ' · loading…' : ` · ${a.feats.length} shown`) : '';
        return `<li><label><input type="checkbox" data-id="${l.id}" ${a ? 'checked' : ''}>
          <span class="dot" style="background:${col}"></span>${l.title}
          <span class="cnt">${l.count.toLocaleString('de-AT')}${l.count > BIG ? ' · nearby' : ''}${status}</span></label></li>`;
      })
      .join('');
  }

  toggle(id, on) {
    const existing = this.active.get(id);
    if (!on) {
      if (existing) {
        existing.abort?.abort();
        if (existing.points) {
          this.scene.remove(existing.points, existing.lines);
          existing.points.geometry.dispose();
          existing.points.material.dispose();
          existing.lines.geometry.dispose();
          existing.lines.material.dispose();
        }
        this.active.delete(id);
      }
      return;
    }
    if (existing) return;
    const meta = this.layers.find((l) => l.id === id);
    if (!meta) return;
    const a = { meta, color: colorFor(id), feats: [], points: null, loading: false, center: null };
    this.active.set(id, a);
    this.load(a);
  }

  async load(a) {
    const p = this.player.pos;
    a.abort?.abort();
    a.abort = new AbortController();
    a.loading = true;
    if (this.open) this.renderList();
    let url = `${WFS}&typeName=ogdwien:${a.meta.id}`;
    if (a.meta.count > BIG) {
      const [lon, lat] = worldToLonLat(p.x, p.z);
      const dLat = RADIUS / 111320, dLon = RADIUS / (111320 * Math.cos((lat * Math.PI) / 180));
      url += `&bbox=${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat},EPSG:4326`;
      a.center = { x: p.x, z: p.z };
    }
    try {
      const j = await (await fetch(url, { signal: a.abort.signal })).json();
      if (this.active.get(a.meta.id) !== a) return;
      a.feats = [];
      for (const f of j.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const coords = g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : [];
        for (const c of coords) {
          const [x, z] = lonLatToWorld(c[0], c[1]);
          a.feats.push({ x, z, y: null, props: f.properties });
        }
      }
      this.rebuild(a);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('POI', a.meta.id, e);
    } finally {
      a.loading = false;
      if (this.open) this.renderList();
    }
  }

  rebuild(a) {
    if (a.points) {
      this.scene.remove(a.points, a.lines);
      a.points.geometry.dispose();
      a.lines.geometry.dispose();
    }
    const n = a.feats.length;
    const pos = new Float32Array(n * 3), line = new Float32Array(n * 6);
    a.feats.forEach((f, i) => {
      const g = this.terrain.heightAt(f.x, f.z);
      f.g = g;
      f.y = g === null ? null : g + HOVER;
      this.place(pos, line, i, f);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(line, 3));
    a.points = new THREE.Points(geo, a.points?.material || pinMaterial(this.tex, a.color));
    a.lines = new THREE.LineSegments(lgeo, a.lines?.material || new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.45, fog: true }));
    a.points.frustumCulled = a.lines.frustumCulled = false;
    this.scene.add(a.points, a.lines);
  }

  place(pos, line, i, f) {
    const g = f.g ?? 170, y = f.y ?? g + HOVER;
    pos.set([f.x, y, f.z], i * 3);
    line.set([f.x, g, f.z, f.x, y, f.z], i * 6);
  }

  update(dt) {
    this.fixT += dt;
    if (this.fixT < 1) return;
    this.fixT = 0;
    const p = this.player.pos;
    for (const a of this.active.values()) {
      if (a.loading || !a.points) continue;
      // reload "nearby" layers when the player moved far enough
      if (a.center && Math.hypot(p.x - a.center.x, p.z - a.center.z) > RADIUS * 0.4) {
        this.load(a);
        continue;
      }
      // place pins whose terrain height wasn't known yet
      const attr = a.points.geometry.attributes.position, lattr = a.lines.geometry.attributes.position;
      let changed = false;
      a.feats.forEach((f, i) => {
        if (f.y !== null) return;
        const g = this.terrain.heightAt(f.x, f.z);
        if (g === null) return;
        f.g = g;
        f.y = g + HOVER;
        this.place(attr.array, lattr.array, i, f);
        changed = true;
      });
      if (changed) attr.needsUpdate = lattr.needsUpdate = true;
    }
  }

  /**
   * Pin whose graphic contains the screen centre, or null. The hitbox is the whole pin
   * (drawn above its anchor), sized like the shader does. Occlusion is checked by the caller.
   */
  pickCenter(camera) {
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    let best = null;
    for (const a of this.active.values())
      for (const f of a.feats) {
        if (f.y === null) continue;
        w.set(f.x, f.y, f.z);
        const dist = camera.position.distanceTo(w);
        const s = PIN_PX * pinScale(dist); // CSS px (three scales point size by the pixel ratio)
        if (!s) continue;
        v.copy(w).project(camera);
        if (v.z > 1 || v.z < -1) continue;
        // screen centre relative to the anchor (tip), y up; the pin fills |x| <= 0.23s, 0 <= y <= 0.5s
        const cx = -v.x * hw, cy = -v.y * hh;
        if (Math.abs(cx) <= 0.23 * s && cy >= 0 && cy <= 0.5 * s && (!best || dist < best.dist)) best = { layer: a.meta, feat: f, dist };
      }
    return best;
  }
}
