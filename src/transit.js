import * as THREE from 'three';
import { lonLatToWorld } from './geo.js';
import { getModel, lineModel, vehicleMaterial } from './vehicles.js';

// Wiener Linien vehicles (U-Bahn, trams, buses, Badner Bahn), moving through the city in real time.
//
// Wiener Linien publish no vehicle positions, so every vehicle runs on the timetable (public/data/transit.json,
// see scripts/build-transit.mjs) and is corrected with the realtime departure monitor of the stops around the
// player: a predicted departure at a stop gives that trip's current delay.
//
// Motion, per vehicle:
//  - The GTFS times are whole minutes, so the timetable is refined first: within ±30 s of each minute, stop times
//    are evened out by an ideal run time per stretch (accelerate, cruise, brake) plus a dwell at each stop.
//  - Between two stops the vehicle follows a trapezoid speed profile (accelerate, cruise, brake) that ends exactly
//    at the stop at the refined arrival time, so it slows down into stations instead of arriving at full speed.
//  - The shown vehicle then follows that target smoothly: speed = target speed + a share of the gap, limited in
//    acceleration, never backwards. New realtime data (delays changing every 30 s) therefore never makes vehicles
//    jump. Overshooting stations is prevented by a braking curve: until the target has left the next stop, the
//    shown vehicle may only go as fast as lets it stop there (v ≤ √(2·b·distance)), and it never passes the stop.
//  - Stretches in tunnels (from OpenStreetMap) are hidden; on bridges and viaducts vehicles ride on the deck height
//    profile sampled from the city's surface model.

const DRIVE = [
  // max speed (m/s), acceleration = braking (m/s²), ideal dwell at a stop (s); per mode
  { vmax: 14, acc: 1.2, dwell: 15 }, // tram
  { vmax: 22, acc: 1.2, dwell: 20 }, // U-Bahn
  { vmax: 14, acc: 1.1, dwell: 12 }, // bus
  { vmax: 16, acc: 1.1, dwell: 10 }, // night bus
  { vmax: 20, acc: 1.2, dwell: 15 }, // Badner Bahn
];
const LAYOVER = 90; // s a vehicle waits at its first stop before departure
const TAU = 4; // s: the shown vehicle closes a gap to its target at about gap / TAU
const SNAP_M = 250; // larger gaps (e.g. a big realtime correction) jump instead
const LIVE_EVERY = 30000; // ms between realtime requests (fair use: at least 15 s)
const LIVE_RADIUS = 1500; // m around the player
const LIVE_MAX = 40; // stops per request (server/wl-monitor.js MAX_STOPS)
const LIVE_MATCH_M = 60; // monitor stop to timetable stop
const LIVE_MATCH_S = 45; // monitor planned time to timetable time
const LIVE_MAX_AGE = 300; // s a delay stays valid without news

const undelta = (a) => {
  let v = 0;
  return a.map((d) => (v += d));
};
const viennaFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
/** ms to add to a UTC timestamp to get Vienna's wall clock time. */
function viennaOffset(ms) {
  const p = Object.fromEntries(viennaFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Shortest time to drive d metres from stop to stop. */
function minRunTime(d, { vmax, acc }) {
  return d < (vmax * vmax) / acc ? 2 * Math.sqrt(d / acc) : d / vmax + vmax / acc;
}

/** Trapezoid speed profile over distance D in time T with acceleration = braking a: [s, v] at time tau. */
function runProfile(D, T, tau, a) {
  if (T <= 0 || D <= 0) return [D, 0];
  let acc = a, v;
  const disc = a * a * T * T - 4 * a * D;
  if (disc >= 0) v = (a * T - Math.sqrt(disc)) / 2;
  else (acc = (4 * D) / (T * T)), (v = (acc * T) / 2); // not enough time at a: triangle, harder
  const ta = v / acc;
  if (tau < ta) return [0.5 * acc * tau * tau, acc * tau];
  if (tau > T - ta) {
    const r = Math.max(0, T - tau);
    return [D - 0.5 * acc * r * r, acc * r];
  }
  return [0.5 * acc * ta * ta + v * (tau - ta), v];
}

/**
 * Refined arrival / departure times (s after the first departure) for a stop pattern and GTFS time profile.
 * GTFS rounds every stop to the minute, which alone would make vehicles race 1-minute stretches and crawl 2-minute
 * ones. Each arrival may move within ±30 s of its timetable minute and is relaxed towards an even pace by ideal
 * dwell + run times (Gauss-Seidel); the first departure and the last arrival stay as published.
 */
function refineTimes(pat, prof, drive) {
  const n = pat.stops.length, d = pat.dists;
  const run = new Float64Array(n), dwell = new Float64Array(n), a = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    run[i] = i ? minRunTime(d[i] - d[i - 1], drive) : 0;
    dwell[i] = i > 0 && i < n - 1 ? Math.max(drive.dwell, prof[2 * i + 1]) : prof[2 * i + 1];
    a[i] = prof[2 * i];
  }
  for (let it = 0; it < 40; it++)
    for (let i = 1; i < n - 1; i++) {
      const w0 = dwell[i - 1] + run[i], w1 = dwell[i] + run[i + 1];
      const x = a[i - 1] + ((a[i + 1] - a[i - 1]) * w0) / (w0 + w1 || 1);
      a[i] = Math.min(prof[2 * i] + 30, Math.max(prof[2 * i] - 30, x));
    }
  const arr = new Float64Array(n), dep = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    arr[i] = i ? Math.max(a[i], dep[i - 1]) : a[0];
    if (i === n - 1) dep[i] = arr[i] + dwell[i];
    else {
      // the dwell, shortened in proportion when the stretch after it is tight
      const span = a[i + 1] - arr[i], need = dwell[i] + run[i + 1];
      dep[i] = arr[i] + Math.max(0, span >= need ? dwell[i] : (span * dwell[i]) / (need || 1));
    }
  }
  return { arr, dep };
}

/** Sorted flat [from, to, from, to, ...] runs: does s lie in one? */
function inRuns(r, s) {
  for (let i = 0; i < r.length; i += 2) if (s >= r[i] && s <= r[i + 1]) return true;
  return false;
}

/** Point at distance s along a shape (extrapolated past its ends). */
function shapePoint(sh, s, out) {
  const D = sh.dist, n = D.length;
  let i;
  if (s <= D[0]) i = 0;
  else if (s >= D[n - 1]) i = n - 2;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (D[mid] <= s) lo = mid;
      else hi = mid;
    }
    i = lo;
  }
  const t = (s - D[i]) / (D[i + 1] - D[i] || 1);
  out.x = sh.x[i] + (sh.x[i + 1] - sh.x[i]) * t;
  out.z = sh.z[i] + (sh.z[i + 1] - sh.z[i]) * t;
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX');
const _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _f = { x: 0, y: 0, z: 0 }, _r = { x: 0, y: 0, z: 0 };

/** One InstancedMesh per car of each vehicle model, grown on demand. */
class Fleet {
  constructor(scene) {
    this.scene = scene;
    this.pools = new Map(); // model key -> [{ mesh, count, owners }] per car
  }
  pool(model) {
    if (!this.pools.has(model.key))
      this.pools.set(model.key, model.cars.map((c) => ({ geo: c.geo, mesh: null, cap: 0, count: 0, owners: [] })));
    return this.pools.get(model.key);
  }
  begin() {
    for (const cars of this.pools.values()) for (const p of cars) (p.count = 0), (p.owners.length = 0);
  }
  add(model, car, matrix, owner) {
    const p = this.pool(model)[car];
    if (p.count >= p.cap) {
      const cap = Math.max(16, p.cap * 2);
      const mesh = new THREE.InstancedMesh(p.geo, vehicleMaterial, cap);
      mesh.frustumCulled = false; // instances move every frame; the bounding sphere is only for picking
      mesh.userData.pick = 'vehicle';
      mesh.userData.owners = p.owners;
      if (p.mesh) {
        mesh.instanceMatrix.array.set(p.mesh.instanceMatrix.array);
        this.scene.remove(p.mesh);
        p.mesh.dispose();
      }
      this.scene.add(mesh);
      p.mesh = mesh;
      p.cap = cap;
    }
    p.mesh.setMatrixAt(p.count, matrix);
    p.owners[p.count++] = owner;
  }
  end(visible) {
    for (const cars of this.pools.values())
      for (const p of cars) {
        if (!p.mesh) continue;
        p.mesh.count = p.count;
        p.mesh.visible = visible && p.count > 0;
        p.mesh.instanceMatrix.needsUpdate = true;
        p.mesh.boundingSphere = null;
      }
  }
  meshes() {
    const out = [];
    for (const cars of this.pools.values()) for (const p of cars) if (p.mesh?.visible) out.push(p.mesh);
    return out;
  }
}

export class Transit {
  constructor({ scene, terrain, player }) {
    this.terrain = terrain;
    this.player = player;
    this.fleet = new Fleet(scene);
    this.enabled = true;
    this.range = 2600;
    this.instances = []; // trips running today (and yesterday's past midnight)
    this.active = [];
    this.day = null;
    this.scanT = 0;
    this.stats = { vehicles: 0, live: 0, liveOk: null };
    this.fallbackDay = null; // timetable day shown when today is outside the timetable
    this.timesCache = new Map();
    this.offset = viennaOffset(Date.now());
    this.offsetT = Date.now();
    this.ready = fetch('/data/transit.json')
      .then((r) => r.json())
      .then((d) => this.load(d))
      .catch((e) => console.warn('transit', e));
    this.liveT = setInterval(() => this.poll(), LIVE_EVERY);
    document.addEventListener('visibilitychange', () => !document.hidden && this.poll());
  }

  load(d) {
    const dayOf = (iso) => Date.parse(iso) / 864e5;
    this.firstDay = dayOf(d.firstDay);
    this.lastDay = dayOf(d.lastDay);
    this.routes = d.routes.map(([name, mode]) => ({ name, mode, model: getModel(lineModel(name, mode)) }));
    this.routesByName = new Map();
    this.routes.forEach((r, i) => this.routesByName.set(r.name, [...(this.routesByName.get(r.name) || []), i]));
    this.headsigns = d.headsigns;
    this.names = d.names;
    const lon = undelta(d.stops[0]), lat = undelta(d.stops[1]);
    this.stopX = new Float64Array(lon.length);
    this.stopZ = new Float64Array(lon.length);
    lon.forEach((v, i) => ([this.stopX[i], this.stopZ[i]] = lonLatToWorld(v / 1e6, lat[i] / 1e6)));
    this.stopName = d.stops[2];
    this.shapes = d.shapes.map(([dlon, dlat, ddist, tun, br, decks]) => {
      const lo = undelta(dlon), la = undelta(dlat), di = undelta(ddist);
      const n = lo.length, x = new Float64Array(n), z = new Float64Array(n), dist = new Float64Array(n);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        [x[i], z[i]] = lonLatToWorld(lo[i] / 1e6, la[i] / 1e6);
        dist[i] = di[i] / 10;
        minX = Math.min(minX, x[i]); maxX = Math.max(maxX, x[i]);
        minZ = Math.min(minZ, z[i]); maxZ = Math.max(maxZ, z[i]);
      }
      const deck = decks.map((h) => undelta(h).map((v) => v / 10));
      return { x, z, dist, tunnels: tun.map((v) => v / 10), bridges: br.map((v) => v / 10), deck, minX, maxX, minZ, maxZ };
    });
    this.patterns = d.patterns.map(([route, shape, dir, headsign, ds, dd], idx) => {
      const stops = undelta(ds), dists = undelta(dd).map((v) => v / 10);
      // shapes need at least two points and stops spread along them
      const ok = this.shapes[shape].dist.length > 1 && dists[dists.length - 1] > dists[0];
      return { idx, route, shape: this.shapes[shape], dir, headsign, stops, dists, ok };
    });
    this.patternsByRoute = this.routes.map(() => []);
    for (const p of this.patterns) this.patternsByRoute[p.route].push(p);
    this.profiles = d.profiles;
    this.services = d.services.map(([mask, start, end, add, remove]) => ({ mask, start, end, add: new Set(undelta(add)), remove: new Set(undelta(remove)) }));
    this.groups = d.trips.map(([pattern, profile, service, starts]) => ({ pattern: this.patterns[pattern], profile, service, starts: undelta(starts) }));
    const rid = undelta(d.rbl[0]), rlon = undelta(d.rbl[1]), rlat = undelta(d.rbl[2]);
    this.rbl = rid.map((id, i) => {
      const [x, z] = lonLatToWorld(rlon[i] / 1e5, rlat[i] / 1e5);
      return { id, x, z };
    });
    this.loaded = true;
    this.poll();
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.poll();
  }

  setRange(m) {
    this.range = m;
  }

  /** Vienna wall clock: { day (days since 1970), sec (seconds after midnight) }. */
  clock() {
    const now = Date.now();
    if (now - this.offsetT > 60000) (this.offset = viennaOffset(now)), (this.offsetT = now);
    const local = now + this.offset;
    const day = Math.floor(local / 864e5);
    return { day, sec: local / 1000 - day * 86400 };
  }

  runsOn(service, day) {
    const s = this.services[service], rel = day - this.firstDay;
    if (s.remove.has(rel)) return false;
    if (s.add.has(rel)) return true;
    const wd = (new Date(day * 864e5).getUTCDay() + 6) % 7;
    return rel >= s.start && rel <= s.end && !!((s.mask >> wd) & 1);
  }

  /** Outside the timetable's period: the same weekday inside it. */
  timetableDay(day) {
    if (day > this.lastDay) return day - 7 * Math.ceil((day - this.lastDay) / 7);
    if (day < this.firstDay) return day + 7 * Math.ceil((this.firstDay - day) / 7);
    return day;
  }

  /** Trip instances of yesterday (still running after midnight) and today. */
  buildInstances(day) {
    const list = [];
    this.byPattern = new Map();
    const shown = this.timetableDay(day);
    this.fallbackDay = shown !== day ? new Date(shown * 864e5) : null;
    for (const D of [day - 1, day]) {
      const tday = this.timetableDay(D), shift = (D - day) * 86400;
      for (const g of this.groups) {
        if (!g.pattern.ok || !this.runsOn(g.service, tday)) continue;
        const prof = this.profiles[g.profile];
        const dur = prof[prof.length - 2] + prof[prof.length - 1];
        for (const st of g.starts) {
          const start = st + shift;
          if (start + dur < -600) continue; // yesterday's, long over
          const inst = { g, pattern: g.pattern, route: this.routes[g.pattern.route], start, end: start + dur, delay: 0, rt: new Map(), veh: null };
          list.push(inst);
          if (!this.byPattern.has(g.pattern.idx)) this.byPattern.set(g.pattern.idx, []);
          this.byPattern.get(g.pattern.idx).push(inst);
        }
      }
    }
    this.instances = list;
    this.active = [];
    this.day = day;
  }

  times(inst) {
    const k = inst.pattern.idx * 100000 + inst.g.profile;
    if (!this.timesCache.has(k)) this.timesCache.set(k, refineTimes(inst.pattern, this.profiles[inst.g.profile], DRIVE[inst.route.mode]));
    return this.timesCache.get(k);
  }

  /** Current delay: the prediction for the next stop ahead, else the latest one. */
  delayOf(inst, sec) {
    if (!inst.rt.size) return 0;
    const { dep } = this.times(inst);
    let best = null, bestK = Infinity, lastK = -1, last = 0;
    for (const [k, r] of inst.rt) {
      if (sec - r.at > LIVE_MAX_AGE) {
        inst.rt.delete(k);
        continue;
      }
      if (inst.start + dep[k] + r.delay >= sec - 5 && k < bestK) (bestK = k), (best = r.delay);
      if (k > lastK) (lastK = k), (last = r.delay);
    }
    return best ?? last;
  }

  /** Which trips run now near the player (every half second). */
  scan(sec) {
    const p = this.player.pos, R = this.range;
    const active = [];
    for (const inst of this.instances) {
      if (sec < inst.start + inst.delay - LAYOVER || sec > inst.end + Math.max(0, inst.delay) + 30) {
        inst.veh = null;
        continue;
      }
      const sh = inst.pattern.shape;
      const dx = Math.max(sh.minX - p.x, 0, p.x - sh.maxX), dz = Math.max(sh.minZ - p.z, 0, p.z - sh.maxZ);
      if (dx * dx + dz * dz > R * R) {
        inst.veh = null;
        continue;
      }
      inst.delay = this.delayOf(inst, sec);
      active.push(inst);
    }
    this.active = active;
  }

  /** Where the timetable (plus delay) puts the vehicle: { s, v, tau }. */
  target(inst, sec) {
    const { arr, dep } = this.times(inst);
    const d = inst.pattern.dists, n = d.length, a = DRIVE[inst.route.mode].acc;
    const tau = sec - inst.start - inst.delay;
    if (tau <= dep[0]) return { s: d[0], v: 0, tau };
    let lo = 0, hi = n - 1; // last stop reached: arr[i] <= tau
    if (tau >= arr[n - 1]) lo = n - 1;
    else
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= tau) lo = mid;
        else hi = mid;
      }
    const i = lo;
    if (i === n - 1 || tau < dep[i]) return { s: d[i], v: 0, tau };
    const [s, v] = runProfile(d[i + 1] - d[i], arr[i + 1] - dep[i], tau - dep[i], a);
    return { s: d[i] + s, v, tau };
  }

  /** Moves the shown vehicle towards its target, braking for stations (see the top of this file). */
  follow(inst, sec, dt) {
    const tgt = this.target(inst, sec);
    const d = inst.pattern.dists, { dep } = this.times(inst);
    const { vmax, acc } = DRIVE[inst.route.mode];
    let v = inst.veh;
    // far ahead: jump; behind its target the vehicle simply waits at the next stop (see below) instead of
    // jumping back, unless the gap is huge
    const gap = v ? tgt.s - v.s : 0;
    if (!v || gap > SNAP_M || gap < -SNAP_M * 6) {
      v = inst.veh = { s: tgt.s, v: tgt.v, j: 0 };
      return v;
    }
    // the stop ahead, or the one the vehicle stands at until the target has left it
    while (v.j < d.length && (d[v.j] < v.s - 0.5 || (d[v.j] <= v.s + 0.5 && tgt.tau >= dep[v.j]))) v.j++;
    let want = Math.max(0, tgt.v + gap / TAU);
    want = Math.min(want, vmax * 1.3);
    // accelerate gently, brake harder if needed
    v.v = want > v.v ? Math.min(want, v.v + acc * 1.5 * dt) : Math.max(want, v.v - acc * 3 * dt);
    // the next stop: unless the target has already left it, be able to stop there, and don't pass it
    const stopAhead = v.j < d.length && tgt.tau < dep[v.j];
    if (stopAhead) v.v = Math.min(v.v, Math.sqrt(2 * acc * Math.max(0, d[v.j] - v.s)));
    v.s += v.v * dt;
    if (stopAhead && v.s > d[v.j]) (v.s = d[v.j]), (v.v = 0);
    return v;
  }

  /** Ground height at a point of a shape: deck on bridge stretches (eased in at the ends), else terrain; null if not loaded. */
  heightAt(sh, s, p) {
    const g = this.terrain.heightAt(p.x, p.z);
    if (g === null) return null;
    const b = sh.bridges;
    for (let i = 0; i < b.length; i += 2) {
      if (s < b[i] || s > b[i + 1]) continue;
      const h = sh.deck[i / 2];
      const f = ((s - b[i]) / (b[i + 1] - b[i] || 1)) * (h.length - 1), k = Math.min(h.length - 2, Math.floor(f));
      const deck = h.length > 1 ? h[k] + (h[k + 1] - h[k]) * (f - k) : h[0];
      const w = Math.min(1, Math.min(s - b[i], b[i + 1] - s) / 15);
      return Math.max(g, g + (deck - g) * w);
    }
    return g;
  }

  update(dt) {
    this.fleet.begin();
    if (!this.loaded || !this.enabled) return this.fleet.end(false);
    const { day, sec } = this.clock();
    if (day !== this.day) this.buildInstances(day);
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      this.scan(sec);
    }
    const p = this.player.pos, R2 = this.range * this.range;
    let shown = 0;
    for (const inst of this.active) {
      const v = this.follow(inst, sec, dt);
      const sh = inst.pattern.shape, model = inst.route.model;
      shapePoint(sh, v.s, _f);
      if ((_f.x - p.x) ** 2 + (_f.z - p.z) ** 2 > R2) continue;
      let any = false;
      model.cars.forEach((car, ci) => {
        const sc = v.s - car.offset;
        if (sh.tunnels.length && inRuns(sh.tunnels, sc)) return; // underground
        shapePoint(sh, sc + car.pivot, _f);
        shapePoint(sh, sc - car.pivot, _r);
        _f.y = this.heightAt(sh, sc + car.pivot, _f);
        _r.y = this.heightAt(sh, sc - car.pivot, _r);
        if (_f.y === null || _r.y === null) return;
        const dx = _f.x - _r.x, dz = _f.z - _r.z, dy = _f.y - _r.y;
        _e.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
        _q.setFromEuler(_e);
        _p.set((_f.x + _r.x) / 2, (_f.y + _r.y) / 2, (_f.z + _r.z) / 2);
        this.fleet.add(model, ci, _m.compose(_p, _q, _one), inst);
        any = true;
      });
      if (any) shown++;
    }
    this.stats.vehicles = shown;
    this.fleet.end(true);
  }

  pickables() {
    return this.enabled ? this.fleet.meshes() : [];
  }

  /** Details for the info box about the vehicle of a picked instance. */
  describe(inst) {
    const { sec } = this.clock();
    const pat = inst.pattern, d = pat.dists;
    const s = inst.veh?.s ?? d[0];
    let j = 0;
    while (j < d.length - 1 && d[j] < s - 1) j++;
    return {
      line: inst.route.name,
      mode: inst.route.mode,
      towards: this.headsigns[pat.headsign].replace(/^Wien /, ''), // as on the vehicle's display
      vehicle: inst.route.model.name,
      next: this.names[this.stopName[pat.stops[j]]],
      live: inst.rt.size ? Math.round(this.delayOf(inst, sec)) : null,
      fallbackDay: this.fallbackDay,
    };
  }

  // ---- realtime ---------------------------------------------------------------------------------
  async poll() {
    if (!this.loaded || !this.enabled || document.hidden || this.polling) return;
    const p = this.player.pos;
    if (!Number.isFinite(p.x)) return;
    const near = this.rbl
      .map((r) => ({ r, d: (r.x - p.x) ** 2 + (r.z - p.z) ** 2 }))
      .filter((e) => e.d < LIVE_RADIUS * LIVE_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, LIVE_MAX)
      .map((e) => e.r.id)
      .sort((a, b) => a - b);
    if (!near.length) return;
    this.polling = true;
    try {
      const r = await fetch(`/api/wl/monitor?stops=${near.join(',')}`);
      if (!r.ok) throw new Error(`monitor ${r.status}`);
      this.applyLive(await r.json());
      this.stats.liveOk = true;
    } catch (e) {
      console.warn('transit live', e);
      this.stats.liveOk = false;
    } finally {
      this.polling = false;
    }
  }

  /** Matches monitor departures to today's trips: same line and direction, stop nearby, same planned time. */
  applyLive(j) {
    if (this.day === null) return;
    const { sec } = this.clock();
    const matched = new Set();
    for (const [, lon, lat, lines] of j.stops) {
      if (!Number.isFinite(lon)) continue;
      const [x, z] = lonLatToWorld(lon, lat);
      for (const [name, hr, deps] of lines) {
        const dir = hr === 'R' ? 1 : 0;
        const cands = [];
        for (const ri of this.routesByName.get(name) || [])
          for (const pat of this.patternsByRoute[ri]) {
            if (pat.dir !== dir || !this.byPattern.has(pat.idx)) continue;
            let k = -1, best = LIVE_MATCH_M * LIVE_MATCH_M;
            pat.stops.forEach((st, i) => {
              const dd = (this.stopX[st] - x) ** 2 + (this.stopZ[st] - z) ** 2;
              if (dd < best) (best = dd), (k = i);
            });
            if (k >= 0) cands.push([pat, k]);
          }
        if (!cands.length) continue;
        for (const [planned, real] of deps) {
          // planned departure as seconds after today's midnight in Vienna
          const ps = (planned + this.offset) / 1000 - this.day * 86400;
          let hit = null, hitK = 0, bestDiff = LIVE_MATCH_S;
          for (const [pat, k] of cands)
            for (const inst of this.byPattern.get(pat.idx)) {
              const prof = this.profiles[inst.g.profile];
              const diff = Math.abs(inst.start + prof[2 * k] + prof[2 * k + 1] - ps);
              if (diff < bestDiff) (bestDiff = diff), (hit = inst), (hitK = k);
            }
          if (hit) {
            hit.rt.set(hitK, { delay: (real - planned) / 1000, at: sec });
            matched.add(hit);
          }
        }
      }
    }
    this.stats.live = matched.size;
  }
}
