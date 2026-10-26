// Spatial hash of building prisms (extruded footprints) for player collision.
// A prism: { rings: Float64Array[] (x,z pairs), minX, maxX, minZ, maxZ, bottom, top }

const CELL = 16;

export class Collision {
  constructor() {
    this.cells = new Map();
    this.stamp = 0;
  }

  _range(p, fn) {
    const x0 = Math.floor(p.minX / CELL), x1 = Math.floor(p.maxX / CELL);
    const z0 = Math.floor(p.minZ / CELL), z1 = Math.floor(p.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn(`${ix},${iz}`);
  }

  add(prisms) {
    for (const p of prisms) {
      p._stamp = 0;
      this._range(p, (k) => {
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(p);
      });
    }
  }

  remove(prisms) {
    const set = new Set(prisms);
    for (const p of prisms)
      this._range(p, (k) => {
        const c = this.cells.get(k);
        if (!c) return;
        const f = c.filter((q) => !set.has(q));
        if (f.length) this.cells.set(k, f);
        else this.cells.delete(k);
      });
  }

  /** All prisms whose footprint overlaps the circle (cx, cz, r). */
  query(cx, cz, r) {
    const out = [];
    const s = ++this.stamp;
    const x0 = Math.floor((cx - r) / CELL), x1 = Math.floor((cx + r) / CELL);
    const z0 = Math.floor((cz - r) / CELL), z1 = Math.floor((cz + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const c = this.cells.get(`${ix},${iz}`);
        if (!c) continue;
        for (const p of c) {
          if (p._stamp === s) continue;
          p._stamp = s;
          if (circleHitsPrism(p, cx, cz, r)) out.push(p);
        }
      }
    return out;
  }
}

function circleHitsPrism(p, cx, cz, r) {
  if (cx + r < p.minX || cx - r > p.maxX || cz + r < p.minZ || cz - r > p.maxZ) return false;
  const r2 = r * r;
  let inside = false;
  for (const ring of p.rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1];
      const xj = ring[j * 2], zj = ring[j * 2 + 1];
      if (zi > cz !== zj > cz && cx < ((xj - xi) * (cz - zi)) / (zj - zi) + xi) inside = !inside;
      // distance from centre to segment
      const dx = xj - xi, dz = zj - zi;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((cx - xi) * dx + (cz - zi) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = xi + t * dx - cx, ez = zi + t * dz - cz;
      if (ex * ex + ez * ez < r2) return true;
    }
  }
  return inside;
}
