import * as THREE from 'three';
import { worldToLonLat, WIENER_NULL } from './geo.js';
import { structureAt } from './structures.js';
import { featureLabel } from './poi.js';
import { t, tText, locale } from './i18n.js';

// Crosshair picking + info popups for buildings, bridges/tunnels, trees and POIs.
const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json';
const PICK_RANGE = 600;

const BR = /<br\s*\/?>/gi;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//.test(v);
const fmt = (v) => (isUrl(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}…</a>` : esc(String(v).replace(BR, ' · ')));
// OGD texts mark line breaks with <br> (any spelling); a real break in titles, ' · ' elsewhere
const brHtml = (s) => esc(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
const pretty = (k) => k.replace(/_TXT$/, '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const SKIP_KEY = /^(OBJECTID|SE_|SHAPE|FID)|_ID$|^ID$|ROWID|ICON|THUMBNAIL|GEOLAT|GEOLONG|^X$|^Y$|RECHTSWERT|HOCHWERT/;

function rows(pairs) {
  return `<table>${pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== -1 && !/^keine angabe$/i.test(String(v).trim()))
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${fmt(v)}</td></tr>`)
    .join('')}</table>`;
}

function allProps(props) {
  // prefer the *_TXT variant over coded duplicates
  const keys = Object.keys(props).filter((k) => !SKIP_KEY.test(k) && !(props[k + '_TXT'] != null));
  return rows(keys.map((k) => [pretty(k), props[k]]));
}

async function wfs(type, lon, lat, d) {
  const r = await fetch(`${WFS}&typeName=ogdwien:${type}&bbox=${lon - d * 1.5},${lat - d},${lon + d * 1.5},${lat + d},EPSG:4326`);
  return (await r.json()).features || [];
}

function inPoly(coords, lon, lat) {
  const polys = coords.length && typeof coords[0][0][0] === 'number' ? [coords] : coords;
  for (const poly of polys) {
    let inside = false;
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    if (inside) return true;
  }
  return false;
}
const metres = (lon1, lat1, lon2, lat2) => Math.hypot((lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 111320);

async function buildingHtml(point) {
  const [lon, lat] = worldToLonLat(point.x, point.z);
  const near = (fs, max) =>
    fs
      .map((f) => ({ f, d: metres(lon, lat, ...f.geometry.coordinates) }))
      .filter((e) => e.d <= max)
      .sort((a, b) => a.d - b.d);
  const [bk, period, info, dach, wiki] = await Promise.all([
    wfs('FMZKBKMOGD', lon, lat, 0.00012).catch(() => []),
    wfs('BAUPERIODEDETAILOGD', lon, lat, 0.00012).catch(() => []),
    wfs('GEBAEUDEINFOOGD', lon, lat, 0.0005).catch(() => []),
    wfs('DACHKATASTEROBJEKTEOGD', lon, lat, 0.0005).catch(() => []),
    wfs('KULTURWIKIOGD', lon, lat, 0.0004).catch(() => []),
  ]);
  const parts = bk.filter((f) => f.geometry && inPoly(f.geometry.coordinates, lon, lat));
  const per = period.find((f) => f.geometry && inPoly(f.geometry.coordinates, lon, lat))?.properties;
  const acd = per?.ACD;
  const gi = (acd && info.find((f) => f.properties.ACD === acd)) || near(info, 35)[0]?.f;
  const g = gi?.properties || {};
  const height = parts.length ? Math.max(...parts.map((f) => f.properties.O_KOTE - f.properties.T_KOTE).filter(Number.isFinite)) : null;
  const ground = parts.length ? Math.min(...parts.map((f) => f.properties.T_KOTE).filter(Number.isFinite)) : null;
  const addr = g.STRNAML ? `${g.STRNAML} ${g.VONN ?? ''}${g.VONA ?? ''}${g.BISN ? '–' + g.BISN : ''}, ${tText('info.district', { n: Number(g.BEZ) || '' })}` : null;

  let html = `<h2>${esc(g.HA_NAME || tText('building'))}</h2>`;
  html += rows([
    [tText('f.address'), addr],
    [tText('f.built'), g.BAUJAHR],
    [tText('f.period'), per?.OBJ_STR_TXT || g.L_BAUJ],
    [tText('f.period2'), per?.OBJ_STR2_TXT],
    [tText('f.type'), per?.BAUTYP_TXT || g.L_BAUTYP],
    [tText('f.use'), g.L_NUTZUNG],
    [tText('f.architect'), g.ARCHITEKT],
    [tText('f.storeys'), g.GESCH_ANZ],
    [tText('f.height'), Number.isFinite(height) ? `${height.toFixed(1)} m` : null],
    [tText('f.ground'), Number.isFinite(ground) ? `${(ground + WIENER_NULL).toFixed(1)} ${tText('info.asl')}` : null],
    [tText('f.conscr'), g.CONSCR_NR],
  ]);
  const d = near(dach, 40)[0]?.f.properties;
  if (d) html += `<h3>${t('info.attic')}</h3>` + rows([[tText('f.object'), d.BEZEICHNUNG], [tText('f.roof'), d.DACHTYP], [tText('f.info'), d.WEBLINK1]]);
  const w = near(wiki, 35).slice(0, 6);
  if (w.length)
    html += `<h3>${t('info.wiki')}</h3><ul>${w
      .map(({ f }) => `<li><a href="${esc(f.properties.WEBLINK1)}" target="_blank" rel="noopener">${esc(f.properties.SEITENNAME)}</a> <span class="muted">${esc(f.properties.ART_DES_BAUWERKS || f.properties.ART_DES_OBJEKTS || f.properties.KATEGORIE_TXT || '')}</span></li>`)
      .join('')}</ul>`;
  if (!gi && !per && !parts.length) html += `<p class="muted">${t('info.none')}</p>`;
  return html;
}

function treeHtml(p) {
  return (
    `<h2>${esc(p.GATTUNG_ART || tText('tree'))}</h2>` +
    rows([
      [tText('f.planted'), p.PFLANZJAHR_TXT || p.PFLANZJAHR],
      [tText('f.age'), p.PFLANZJAHR > 1000 ? tText('info.years', { n: new Date().getFullYear() - p.PFLANZJAHR }) : null],
      [tText('f.height'), p.BAUMHOEHE_TXT],
      [tText('f.crown'), p.KRONENDURCHMESSER_TXT],
      [tText('f.trunk'), p.STAMMUMFANG_TXT],
      [tText('f.location'), p.OBJEKT_STRASSE],
      [tText('f.district'), p.BEZIRK],
      [tText('f.treeNo'), p.BAUMNUMMER],
      [tText('f.responsible'), p.GEBIETSGRUPPE],
    ])
  );
}

function riesenradHtml() {
  return (
    `<h2>${t('rr.name')}</h2>` +
    rows([
      [tText('rr.opened'), tText('rr.openedVal')],
      [tText('rr.builder'), 'Walter Basset'],
      [tText('f.height'), `${(64.75).toLocaleString(locale())} m`],
      [tText('rr.diameter'), `${(60.96).toLocaleString(locale())} m`],
      [tText('rr.gondolas'), tText('rr.gondolasVal')],
      [tText('rr.speed'), tText('rr.speedVal')],
      [tText('rr.weight'), '430 t'],
    ]) +
    `<p class="muted">${t('rr.model')}</p>`
  );
}

function structureHtml(s, point, terrain) {
  const g = terrain.heightAt(point.x, point.z);
  return (
    `<h2>${esc(s.name || tText(s.kind === 't' ? 'tunnel' : 'bridge'))}</h2>` +
    rows([
      [tText('f.kind'), tText(s.kind === 't' ? 'kind.tunnel' : 'bridge')],
      [tText('f.operator'), s.op],
      [tText('f.objectNo'), s.id],
      [tText('f.length'), s.len ? `${s.len} m` : null],
      [tText(s.kind === 't' ? 'f.aboveTerrain' : 'f.aboveGround'), g !== null ? `${(point.y - g).toFixed(1)} m` : null],
    ])
  );
}

export class InfoUI {
  constructor({ camera, chunks, pois, terrain }) {
    this.camera = camera;
    this.chunks = chunks;
    this.pois = pois;
    this.terrain = terrain;
    this.extra = []; // pickable models outside the chunks (Riesenrad)
    this.ray = new THREE.Raycaster();
    this.ray.far = PICK_RANGE;
    this.ray.firstHitOnly = true;
    this.occl = new THREE.Raycaster();
    this.occl.firstHitOnly = true;
    this.panel = document.getElementById('info-panel');
    this.body = document.getElementById('info-body');
    this.aim = document.getElementById('aim-label');
    this.hoverT = 0;
    this.req = 0;
    document.getElementById('info-close').addEventListener('click', () => this.close());
  }

  get open() {
    return !this.panel.classList.contains('hidden');
  }

  targets() {
    const objs = [...this.extra];
    for (const c of this.chunks.chunks.values())
      if (c.dist <= 4) c.group.traverse((o) => o.userData.pick && objs.push(o));
    return objs;
  }

  /** Distance to whatever the crosshair hits (ground included), or null within PICK_RANGE. */
  aimDistance() {
    this.ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    return this.ray.intersectObjects(this.targets(), false)[0]?.distance ?? null;
  }

  /** What's under the crosshair: { kind, label, ... } or null. */
  pick() {
    let poi = this.pois.pickCenter(this.camera);
    const objs = this.targets();
    // a pin counts only if nothing (buildings, terrain, ...) sits between camera and pin
    if (poi) {
      const target = new THREE.Vector3(poi.feat.x, poi.feat.y, poi.feat.z);
      const dir = target.clone().sub(this.camera.position).normalize();
      this.occl.set(this.camera.position, dir);
      this.occl.far = poi.dist - 0.5;
      if (this.occl.intersectObjects(objs, false).length) poi = null;
    }
    this.ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hit = this.ray.intersectObjects(objs, false)[0];
    if (poi && (!hit || poi.dist <= hit.distance)) {
      return { kind: 'poi', label: `${poi.layer.title}: ${featureLabel(poi.feat.props, poi.layer).replace(BR, ' · ')}`, poi };
    }
    if (!hit) return null;
    const kind = hit.object.userData.pick;
    if (kind === 'ground') return null;
    if (kind === 'riesenrad') return { kind, label: tText('rr.name') };
    if (kind === 'tree') {
      const p = hit.object.userData.items[hit.instanceId]?.props || {};
      return { kind, label: tText('aim.tree', { name: p.GATTUNG_ART || '?' }), props: p };
    }
    if (kind === 'structure') {
      const s = structureAt(hit.point.x, hit.point.z);
      return { kind, label: s?.name || tText('bridge'), s, point: hit.point.clone() };
    }
    return { kind: 'building', label: tText('building'), point: hit.point.clone() };
  }

  update(dt, active) {
    this.hoverT += dt;
    if (!active) return (this.aim.textContent = '');
    if (this.hoverT < 0.12) return;
    this.hoverT = 0;
    const hit = this.pick();
    this.aim.textContent = hit ? hit.label : '';
  }

  async click() {
    const hit = this.pick();
    if (!hit) return this.close();
    const id = ++this.req;
    this.panel.classList.remove('hidden');
    if (hit.kind === 'poi') {
      this.body.innerHTML = `<div class="kicker">${esc(hit.poi.layer.title)}</div><h2>${brHtml(featureLabel(hit.poi.feat.props, hit.poi.layer))}</h2>` + allProps(hit.poi.feat.props);
    } else if (hit.kind === 'riesenrad') {
      this.body.innerHTML = `<div class="kicker">${t('rr.kicker')}</div>` + riesenradHtml();
    } else if (hit.kind === 'tree') {
      this.body.innerHTML = `<div class="kicker">${t('info.trees')}</div>` + treeHtml(hit.props);
    } else if (hit.kind === 'structure') {
      this.body.innerHTML = `<div class="kicker">${t('info.structures')}</div>` + (hit.s ? structureHtml(hit.s, hit.point, this.terrain) : `<h2>${t('bridge')}</h2>`);
    } else {
      this.body.innerHTML = `<div class="kicker">${t('building')}</div><p class="muted">${t('info.loading')}</p>`;
      try {
        const html = await buildingHtml(hit.point);
        if (id === this.req) this.body.innerHTML = `<div class="kicker">${t('building')}</div>` + html;
      } catch (e) {
        if (id === this.req) this.body.innerHTML = `<div class="kicker">${t('building')}</div><p class="muted">${t('info.unavailable', { e: esc(e.message) })}</p>`;
      }
    }
  }

  close() {
    this.req++;
    this.panel.classList.add('hidden');
  }
}
