import * as THREE from 'three';

// Minecraft (Java) creative-mode feel, 1 block = 1 m.
const WIDTH_R = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const EYE_SNEAK = 1.27;
const STEP = 0.6;
const GRAVITY = 32;
const JUMP_V = 9;
const TERMINAL = 78;
const SPEED_SCALE = 2; // Minecraft speeds feel slow at city scale
const SPEED = Object.fromEntries(
  Object.entries({ walk: 4.317, sprint: 5.612, sneak: 1.31, fly: 10.92, flySprint: 21.78, flyVert: 7.5 }).map(([k, v]) => [k, v * SPEED_SCALE])
);
export const SPEED_STEPS = [1, 2, 4, 8, 16, 32, 64];
const DOUBLE_TAP = 300;
const EPS = 1e-3;

// height of a prism's top at (x, z): flat, or a sloped roof plane clamped to the triangle's height range
const topAt = (q, x, z) => (q.plane ? Math.min(q.top, Math.max(q.minTop, q.plane[0] * x + q.plane[1] * z + q.plane[2])) : q.top);

export class Player {
  constructor(camera, dom, terrain, collision) {
    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.collision = collision;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.flying = true;
    this.noclip = false;
    this.sprinting = false;
    this.onGround = false;
    this.speedIdx = 0;
    this.keys = new Set();
    this.eye = EYE;
    this.baseFov = camera.fov;
    this.lastSpace = 0;
    this.lastW = 0;
    this.locked = false;
    this.onToggle = () => {};

    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.keys.clear();
      this.onToggle(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022;
      this.yaw -= e.movementX * s;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch - e.movementY * s));
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.speedIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, this.speedIdx + (e.deltaY < 0 ? 1 : -1)));
      },
      { passive: true }
    );
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (e.code.startsWith('Control') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) {
        const now = performance.now();
        if (e.code === 'Space') {
          if (now - this.lastSpace < DOUBLE_TAP && !this.noclip) {
            this.flying = !this.flying;
            this.vel.y = 0;
            this.lastSpace = 0;
          } else this.lastSpace = now;
        }
        if (e.code === 'KeyW') {
          if (now - this.lastW < DOUBLE_TAP) this.sprinting = true;
          this.lastW = now;
        }
        if (e.code === 'ControlLeft' || e.code === 'KeyR') this.sprinting = true;
        if (e.code === 'KeyN') {
          this.noclip = !this.noclip;
          if (this.noclip) this.flying = true;
        }
      }
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  get speedMult() {
    return SPEED_STEPS[this.speedIdx];
  }

  lock() {
    const p = this.dom.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.dom.requestPointerLock());
  }

  teleport(x, z, yAboveGround = 60) {
    this.pos.set(x, NaN, z);
    this.pendingHeight = yAboveGround;
    this.vel.set(0, 0, 0);
    this.flying = true;
  }

  update(dt) {
    const k = this.keys;
    if (Number.isNaN(this.pos.y)) {
      const g = this.terrain.heightAt(this.pos.x, this.pos.z);
      if (g === null) return this.syncCamera(dt);
      this.pos.y = g + this.pendingHeight;
    }

    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (fwd <= 0) this.sprinting = false;
    const up = k.has('Space');
    const down = k.has('ShiftLeft') || k.has('ShiftRight');
    const sneaking = down && !this.flying;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * str;
    let wz = -cos * fwd - sin * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) (wx /= wl), (wz /= wl);

    const m = this.speedMult;
    if (this.flying) {
      const sp = (this.sprinting ? SPEED.flySprint : SPEED.fly) * m;
      const a = 1 - Math.exp(-dt * 6);
      this.vel.x += (wx * sp - this.vel.x) * a;
      this.vel.z += (wz * sp - this.vel.z) * a;
      this.vel.y += (((up ? 1 : 0) - (down ? 1 : 0)) * SPEED.flyVert * m - this.vel.y) * a;
    } else {
      const sp = (sneaking ? SPEED.sneak : this.sprinting ? SPEED.sprint : SPEED.walk) * m;
      const a = 1 - Math.exp(-dt * (this.onGround ? 20 : 4));
      this.vel.x += (wx * sp - this.vel.x) * a;
      this.vel.z += (wz * sp - this.vel.z) * a;
      this.vel.y = Math.max(-TERMINAL, this.vel.y - GRAVITY * dt);
      if (up && this.onGround) this.vel.y = JUMP_V;
    }

    // don't fall through ground that hasn't streamed in yet
    if (this.terrain.heightAt(this.pos.x, this.pos.z) === null) this.vel.set(0, 0, 0);

    const dist = this.vel.length() * dt;
    const n = Math.min(80, Math.max(1, Math.ceil(dist / 0.2)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h);

    this.eye += ((sneaking ? EYE_SNEAK : EYE) - this.eye) * (1 - Math.exp(-dt * 15));
    this.syncCamera(dt);
  }

  syncCamera(dt) {
    const c = this.camera;
    c.position.set(this.pos.x, (Number.isNaN(this.pos.y) ? 400 : this.pos.y) + this.eye, this.pos.z);
    c.rotation.set(this.pitch, this.yaw, 0);
    const targetFov = this.baseFov * (this.sprinting ? 1.15 : 1);
    if (Math.abs(c.fov - targetFov) > 0.01) {
      c.fov += (targetFov - c.fov) * (1 - Math.exp(-dt * 10));
      c.updateProjectionMatrix();
    }
  }

  // ---- collision helpers --------------------------------------------------------------------
  terrainUnder(x, z) {
    // inside a tunnel footprint (below its roof) the terrain doesn't exist
    for (const q of this.collision.query(x, z, 0)) if (q.void && this.pos.y < q.top - 0.3) return -Infinity;
    let g = -Infinity;
    for (const [ox, oz] of [[0, 0], [WIDTH_R, 0], [-WIDTH_R, 0], [0, WIDTH_R], [0, -WIDTH_R]]) {
      const h = this.terrain.heightAt(x + ox, z + oz);
      if (h !== null && h > g) g = h;
    }
    return g;
  }

  blockers(x, y, z) {
    return this.collision.query(x, z, WIDTH_R).filter((p) => !p.void && p.bottom < y + HEIGHT - EPS && topAt(p, x, z) > y + EPS);
  }

  step(h) {
    const p = this.pos, v = this.vel;
    if (this.noclip) {
      p.addScaledVector(v, h);
      this.onGround = false;
      return;
    }

    // --- vertical
    const dy = v.y * h;
    if (dy < 0) {
      let support = this.terrainUnder(p.x, p.z);
      for (const q of this.collision.query(p.x, p.z, WIDTH_R)) if (!q.void) {
        const t = topAt(q, p.x, p.z);
        if (t <= p.y + EPS && t > support) support = t;
      }
      if (p.y + dy <= support) {
        p.y = support;
        v.y = 0;
        this.onGround = true;
        if (this.flying) this.flying = false; // landing ends flight, like Minecraft
      } else {
        p.y += dy;
        this.onGround = false;
      }
    } else if (dy > 0) {
      let ceil = Infinity;
      for (const q of this.collision.query(p.x, p.z, WIDTH_R)) if (!q.void && q.bottom >= p.y + HEIGHT - EPS && q.bottom < ceil) ceil = q.bottom;
      if (p.y + HEIGHT + dy >= ceil) {
        p.y = ceil - HEIGHT;
        v.y = 0;
      } else p.y += dy;
      this.onGround = false;
    }

    // --- horizontal, one axis at a time (Minecraft style)
    this.moveAxis('x', v.x * h);
    this.moveAxis('z', v.z * h);

    const g = this.terrainUnder(p.x, p.z);
    if (p.y < g) {
      p.y = g;
      if (v.y < 0) v.y = 0;
    }
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const p = this.pos;
    const old = p[axis];
    p[axis] += d;
    const hit = this.blockers(p.x, p.y, p.z);
    if (!hit.length) return;
    // allow walking out of something we're already stuck in
    p[axis] = old;
    const before = new Set(this.blockers(p.x, p.y, p.z));
    p[axis] += d;
    if (hit.every((q) => before.has(q))) return;

    // auto step-up (0.6 m, like stairs/slabs)
    if (this.onGround) {
      const maxTop = Math.max(...hit.map((q) => topAt(q, p.x, p.z)));
      if (maxTop - p.y <= STEP && !this.blockers(p.x, maxTop, p.z).length) {
        p.y = maxTop;
        return;
      }
    }
    p[axis] = old;
    this.vel[axis] = 0;
    if (axis === 'x' || axis === 'z') this.sprinting = this.sprinting && this.flying;
  }
}
