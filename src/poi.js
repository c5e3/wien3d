import * as THREE from 'three';
import { lonLatToWorld, worldToLonLat } from './geo.js';
import { iconFor, pinCanvas, iconBadge, PIN_HIT, CATEGORIES, OTHER, categoryFor } from './poi-icons.js';
import { t, locale, categoryName } from './i18n.js';

// Every point layer of the Stadt Wien WFS (index: scripts/build-poi-layers.mjs), shown as floating pins.
const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json';
const BIG = 5000; // larger layers are loaded around the player only
const HOVER = 12; // pin tip height above the highest solid surface below it (m), joined to it by a faint line
const PIN_PX = 64; // point sprite size; the pin itself fills the upper half (tip = anchor)
const EDGE = 15; // m: also probe neighbouring chunks this close, for roofs and crowns overhanging a tile border

function pinTexture(color, icon) {
  const t = new THREE.CanvasTexture(pinCanvas('#' + color.getHexString(), icon));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// = fog far: beyond it pins would be fully fogged anyway (render distance setting, see setRange)
const maxDist = { value: 2600 };
const radius = () => maxDist.value * 0.77; // m: larger layers are loaded this far around the player

// screen size factor by distance; must match the shader below
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pinScale = (d) => (d > maxDist.value ? 0 : 1 - 0.55 * smooth(150, maxDist.value, d));

// fixed-pixel pins, depth tested (hidden behind buildings), fogged like the map, shrinking with distance
function pinMaterial(map) {
  const m = new THREE.PointsMaterial({ size: PIN_PX, sizeAttenuation: false, map, transparent: true, alphaTest: 0.4, fog: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.pinMaxDist = maxDist;
    s.vertexShader = 'uniform float pinMaxDist;\n' + s.vertexShader.replace(
      'gl_PointSize = size;',
      `float pinDist = length(mvPosition.xyz);
      gl_PointSize = pinDist > pinMaxDist ? 0.0 : size * mix(1.0, 0.45, smoothstep(150.0, pinMaxDist, pinDist));`
    );
  };
  return m;
}

// distinct colours (all readable under a white glyph), handed to layers in the order they are switched on
const PALETTE = ['#c8023c', '#1971c2', '#2f9e44', '#e8590c', '#7048e8', '#0c8599', '#9c36b5', '#8d5524', '#5c940d', '#495057'];
const INACTIVE = '#8a8a8a';
const SECTION_ORDER = [...CATEGORIES.map(([name]) => name), OTHER];
const OPEN_KEY = 'wien3d.poiSections'; // expanded list sections, per browser

export function featureLabel(props, layer) {
  if (layer?.label && props[layer.label]) return String(props[layer.label]);
  for (const [k, v] of Object.entries(props))
    if (typeof v === 'string' && v.length > 1 && v.length < 80 && !/ID$|^SE_|LINK|URL|DATUM|ZEIT/.test(k) && !/^https?:/.test(v)) return v;
  return layer?.title || 'POI';
}

export class PoiManager {
  constructor({ scene, terrain, player, chunks }) {
    this.scene = scene;
    this.terrain = terrain;
    this.player = player;
    this.chunks = chunks;
    this.layers = [];
    this.active = new Map();
    this.ray = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0), 0, 8000);
    this.ray.firstHitOnly = true;
    this.fixT = 0;
    this.ready = fetch('/data/poi-layers.json')
      .then((r) => r.json())
      .then((l) => (this.layers = l))
      .catch(() => {});

    this.panel = document.getElementById('poi-panel');
    this.list = document.getElementById('poi-list');
    this.search = document.getElementById('poi-search');
    this.search.addEventListener('input', () => this.renderList());
    try {
      this.expanded = new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []);
    } catch {
      this.expanded = new Set();
    }
    this.list.addEventListener('click', (e) => {
      const head = e.target.closest('.sec-head');
      if (!head || this.search.value.trim()) return; // while searching every matching section is open
      const cat = head.dataset.cat;
      if (!this.expanded.delete(cat)) this.expanded.add(cat);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...this.expanded]));
      } catch {}
      this.renderList();
    });
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

  async show(focus = true) {
    await this.ready;
    this.panel.classList.remove('hidden');
    this.renderList();
    if (focus) this.search.focus(); // not on touch: it would pop up the keyboard
  }

  hide() {
    this.panel.classList.add('hidden');
    this.search.blur();
  }

  renderList() {
    const q = this.search.value.trim().toLowerCase();
    const rows = this.layers.filter((l) => !q || l.title.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
    const sections = new Map(SECTION_ORDER.map((name) => [name, []]));
    for (const l of rows) sections.get((l.cat ??= categoryFor(l))).push(l);
    const item = (l) => {
      const a = this.active.get(l.id);
      const col = a ? '#' + a.color.getHexString() : INACTIVE;
      l.icon ??= iconFor(l);
      const status = a ? ' · ' + (a.loading ? t('poi.loading') : t('poi.shown', { n: a.feats.length.toLocaleString(locale()) })) : '';
      return `<li><label><input type="checkbox" data-id="${l.id}" ${a ? 'checked' : ''}>
        ${iconBadge(col, l.icon)}<span class="name">${l.title}</span>
        <span class="cnt">${l.count.toLocaleString(locale())}${l.count > BIG ? ' · ' + t('poi.nearby') : ''}${status}</span></label></li>`;
    };
    this.list.innerHTML =
      [...sections]
        .filter(([, ls]) => ls.length)
        .map(([cat, ls]) => {
          const open = q || this.expanded.has(cat);
          const on = ls.filter((l) => this.active.has(l.id)).length;
          return `<li class="sec${open ? ' open' : ''}">
            <button type="button" class="sec-head" data-cat="${cat}" aria-expanded="${!!open}">
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span class="sec-name">${categoryName(cat)}</span>${on ? `<span class="sec-on">${t('poi.on', { n: on })}</span>` : ''}<span class="cnt">${ls.length}</span>
            </button>
            ${open ? `<ul>${ls.map(item).join('')}</ul>` : ''}</li>`;
        })
        .join('') || `<li class="empty">${t('poi.none')}</li>`;
  }

  toggle(id, on) {
    const existing = this.active.get(id);
    if (!on) {
      if (existing) {
        existing.abort?.abort();
        if (existing.points) {
          this.scene.remove(existing.points, existing.lines);
          existing.points.geometry.dispose();
          existing.points.material.map.dispose();
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
    const used = new Set([...this.active.values()].map((x) => x.color.getHex()));
    const hex = PALETTE.find((c) => !used.has(new THREE.Color(c).getHex())) ?? PALETTE[this.active.size % PALETTE.length];
    const a = { meta, color: new THREE.Color(hex), feats: [], points: null, loading: false, center: null };
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
      const dLat = radius() / 111320, dLon = radius() / (111320 * Math.cos((lat * Math.PI) / 180));
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
          a.feats.push({ x, z, y: null, g: null, key: null, props: f.properties });
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
      this.settle(f);
      this.place(pos, line, i, f);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(line, 3));
    a.points = new THREE.Points(geo, a.points?.material || pinMaterial(pinTexture(a.color, iconFor(a.meta))));
    a.lines = new THREE.LineSegments(lgeo, a.lines?.material || new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.45, fog: true }));
    a.points.frustumCulled = a.lines.frustumCulled = false;
    this.scene.add(a.points, a.lines);
  }

  /**
   * Highest solid surface (terrain, roof, bridge deck, tree crown, ...) straight below (x, z), with a key of
   * the chunk revisions it was measured on, or null while not even the terrain is known.
   */
  surfaceAt(x, z) {
    const near = this.chunks.around(x, z, EDGE);
    const key = near.map((c) => c.rev).join(',');
    let y = -Infinity;
    if (near.length) {
      const meshes = [], trees = new Set();
      for (const o of near.flatMap((c) => c.pickables())) (o.userData.pick === 'tree' ? trees.add(o.userData.items) : meshes.push(o));
      this.ray.ray.origin.set(x, 5000, z);
      const hit = this.ray.intersectObjects(meshes, false)[0];
      if (hit) y = hit.point.y;
      // trees analytically (raycasting instanced meshes tests every instance): crown top g + h, radius d / 2
      for (const items of trees)
        for (const t of items) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.d / 2) ** 2) y = Math.max(y, t.g + t.h);
    }
    if (y > -Infinity) return { y, key };
    const g = this.terrain.heightAt(x, z);
    return g === null ? null : { y: g, key };
  }

  /** (Re)place a pin on what's below it; true if it moved. */
  settle(f) {
    if (f.y !== null && this.chunks.around(f.x, f.z, EDGE).map((c) => c.rev).join(',') === f.key) return false;
    const s = this.surfaceAt(f.x, f.z);
    if (!s) return false;
    f.key = s.key;
    if (f.g === s.y) return false;
    f.g = s.y;
    f.y = s.y + HOVER;
    return true;
  }

  place(pos, line, i, f) {
    const g = f.g ?? 170, y = f.y ?? g + HOVER;
    pos.set([f.x, y, f.z], i * 3);
    line.set([f.x, g, f.z, f.x, y, f.z], i * 6);
  }

  /** Render distance in metres: pins fade out there, large layers load around the player that far. */
  setRange(m) {
    if (maxDist.value === m) return;
    maxDist.value = m;
    for (const a of this.active.values()) if (a.center) this.load(a);
  }

  update(dt) {
    this.fixT += dt;
    if (this.fixT < 1) return;
    this.fixT = 0;
    const p = this.player.pos;
    for (const a of this.active.values()) {
      if (a.loading || !a.points) continue;
      // reload "nearby" layers when the player moved far enough
      if (a.center && Math.hypot(p.x - a.center.x, p.z - a.center.z) > radius() * 0.4) {
        this.load(a);
        continue;
      }
      // re-place pins whose ground wasn't known yet or whose chunks gained buildings, bridges or trees
      const attr = a.points.geometry.attributes.position, lattr = a.lines.geometry.attributes.position;
      let changed = false;
      a.feats.forEach((f, i) => {
        if (!this.settle(f)) return;
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
        // screen centre relative to the anchor (tip), y up
        const cx = -v.x * hw, cy = -v.y * hh;
        if (Math.abs(cx) <= PIN_HIT.w * s && cy >= 0 && cy <= PIN_HIT.h * s && (!best || dist < best.dist)) best = { layer: a.meta, feat: f, dist };
      }
    return best;
  }
}
