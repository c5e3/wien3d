import * as THREE from 'three';
import { mdiMagnify } from '@mdi/js';
import { lonLatToWorld } from './geo.js';
import { pinMaterial, pinTexture } from './poi.js';
import { t, tText } from './i18n.js';

// Address search, opened by clicking or tapping the compass, on the city's address service (data.gv.at
// "Adressservice Wien"). One house number can have several entrances ("Stiegen": Schiffmühlenstraße 58-64/10, 58-64/7) or
// allotment plots ("Satzingerweg 14 Parz. 3"), each at its own location. The service lists those only for a
// complete house number, so for "street + number" the whole street is fetched once ("Schiffmühlenstraße 1-9999",
// every district that has a street of that name) and filtered here by the typed number prefix.
const API = 'https://data.wien.gv.at/daten/OGDAddressService.svc/GetAddressInfo?crs=EPSG:4326&Address=';
const MAX = 100; // list rows; the rest asks for a more precise input
const VIEW_HEIGHT = 200; // m above ground, looking straight down, north up

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const collator = new Intl.Collator('de', { numeric: true });

// "Schiffmühlenstraße 58-64/10", "Am Wasserpark 11 Parz 4" → street + number; "Schiffmühlenstraße " (trailing space) → every number
const STREET_NUM = /^(.*?[^\d\s,])[\s,]+(\d.*)?$/;
// comparable house numbers: "14 Parz. 3", "14/3", "14 3" → "14/3"; "24 A" → "24a"
const norm = (s) =>
  s.toLowerCase().replace(/\s*parz\.?\s*/g, '/').replace(/\s*\/\s*/g, '/').replace(/(\d)\s+(?=\d)/g, '$1/').replace(/[\s.]/g, '');
// a half typed "Parz." counts as the separator
const normTyped = (s) => norm(s.replace(/\s+p(a(rz?)?)?\.?$/i, '/'));

async function query(text, signal) {
  const r = await fetch(API + encodeURIComponent(text), { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.text(); // no match: empty body
  return body ? JSON.parse(body).features ?? [] : [];
}

const key = (f) => `${f.properties.Adresse}|${f.properties.Bezirk}|${f.geometry.coordinates}`;

export class AddressSearch {
  constructor({ scene, player, pois }) {
    this.player = player;
    this.pois = pois;
    this.panel = document.getElementById('search-panel');
    this.input = document.getElementById('addr-search');
    this.list = document.getElementById('addr-list');
    this.streets = new Map(); // lower-case street → Promise of all its addresses
    this.results = [];
    this.sel = 0;
    this.req = 0;
    this.timer = 0;
    this.abort = null;
    this.onPick = () => {};

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), 180);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (this.results.length) this.select((this.sel + (e.code === 'ArrowDown' ? 1 : this.results.length - 1)) % this.results.length);
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (this.results[this.sel]) this.pick(this.results[this.sel]);
      }
    });
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) this.pick(this.results[+li.dataset.i]);
    });

    // marker on the chosen spot, placed like the POI pins (PoiManager.settle / place): hovering over the highest
    // solid surface there, joined to it by a thin line
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const color = new THREE.Color('#c8023c');
    this.pin = new THREE.Points(geo, pinMaterial(pinTexture(color, mdiMagnify), 80));
    this.line = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, fog: true }));
    this.pin.frustumCulled = this.line.frustumCulled = false;
    this.pin.visible = this.line.visible = false;
    scene.add(this.pin, this.line);
    this.mark = null; // a POI-like feature: { x, z, y, g, key }
    this.markT = 0;
  }

  get open() {
    return !this.panel.classList.contains('hidden');
  }

  show() {
    this.panel.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (!this.input.value.trim()) this.render();
  }

  hide() {
    this.panel.classList.add('hidden');
    this.input.blur(); // drops the on-screen keyboard
  }

  /** All addresses of a street (fuzzy name, like the service's own search), cached. */
  street(name) {
    const k = name.toLowerCase();
    if (!this.streets.has(k)) {
      const p = query(`${name} 1-9999`).then((fs) => fs.filter((f) => f.properties.Kategorie === 'Adresse'));
      p.catch(() => this.streets.delete(k)); // retry next time
      this.streets.set(k, p);
    }
    return this.streets.get(k);
  }

  async search() {
    const raw = this.input.value.replace(/^\s+/, '');
    const id = ++this.req;
    this.abort?.abort();
    if (!raw.trim()) return this.render();
    this.abort = new AbortController();
    this.list.innerHTML = `<li class="empty">${t('search.loading')}</li>`;
    try {
      const m = STREET_NUM.exec(raw);
      const [plain, all] = await Promise.all([query(raw.trim(), this.abort.signal), m ? this.street(m[1]) : []]);
      if (id !== this.req) return;
      let rows = plain;
      if (m) {
        const num = normTyped(m[2] ?? '');
        const hits = all
          .map((f) => ({ f, n: norm(f.properties.StreetNumber ?? '') }))
          .filter((h) => h.n.startsWith(num))
          .sort((a, b) => collator.compare(a.n, b.n) || a.f.properties.Bezirk - b.f.properties.Bezirk)
          .map((h) => h.f);
        const seen = new Set(hits.map(key));
        const rest = plain.filter((f) => !seen.has(key(f)));
        // just the street so far: the street itself first, then its numbers; else the matching numbers first
        rows = num ? [...hits, ...rest] : [...rest, ...hits];
      }
      this.render(rows);
    } catch (e) {
      if (id !== this.req || e.name === 'AbortError') return;
      this.results = [];
      this.list.innerHTML = `<li class="empty">${t('search.error', { e: esc(e.message) })}</li>`;
    }
  }

  render(rows) {
    this.sel = 0;
    if (!rows) {
      this.results = [];
      this.list.innerHTML = `<li class="empty">${t('search.hint')}</li>`;
      return;
    }
    this.results = rows.slice(0, MAX);
    if (!rows.length) {
      this.list.innerHTML = `<li class="empty">${t('search.none')}</li>`;
      return;
    }
    this.list.innerHTML =
      this.results
        .map((f, i) => {
          const p = f.properties;
          const kind = p.Kategorie === 'Adresse' ? '' : p.Kategorie === 'Strassenname' ? tText('search.street') : p.Kategorie;
          const where = p.PostalCode ? `${p.PostalCode} ${p.MunicipalitySubdivision}` : p.Bezirk ? tText('info.district', { n: p.Bezirk }) : '';
          const sub = [kind, where].filter(Boolean).map(esc).join(' · ');
          return `<li data-i="${i}"${i === 0 ? ' class="sel"' : ''}><b>${esc(p.Adresse)}</b>${sub ? `<small>${sub}</small>` : ''}</li>`;
        })
        .join('') + (rows.length > MAX ? `<li class="empty">${t('search.more', { n: rows.length - MAX })}</li>` : '');
  }

  select(i) {
    this.list.children[this.sel]?.classList.remove('sel');
    this.sel = i;
    const li = this.list.children[i];
    li.classList.add('sel');
    li.scrollIntoView({ block: 'nearest' });
  }

  pick(f) {
    const p = f.properties;
    // a street name completes the input and lists its numbers; picked again (or with a number) it is flown to
    if (p.Kategorie === 'Strassenname' && this.input.value.trim().toLowerCase() !== p.Adresse.toLowerCase()) {
      this.input.value = `${p.Adresse} `;
      this.input.focus();
      return this.search();
    }
    const [x, z] = lonLatToWorld(...f.geometry.coordinates);
    this.player.teleport(x, z, VIEW_HEIGHT);
    this.player.yaw = 0;
    this.player.pitch = -Math.PI / 2 + 0.001;
    this.mark = { x, z, y: null, g: null, key: null };
    this.markT = Infinity; // place it right away
    this.pin.visible = this.line.visible = false; // until the ground there is known
    this.onPick(f);
  }

  /** Keeps the marker on the highest surface below it as buildings and trees stream in. */
  update(dt) {
    if (!this.mark) return;
    this.markT += dt;
    if (this.markT < 0.5) return;
    this.markT = 0;
    const pos = this.pin.geometry.attributes.position, line = this.line.geometry.attributes.position;
    if (!this.pois.settle(this.mark)) return;
    this.pois.place(pos.array, line.array, 0, this.mark);
    pos.needsUpdate = line.needsUpdate = true;
    this.pin.visible = this.line.visible = true;
  }
}
