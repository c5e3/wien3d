import * as THREE from 'three';
import { Drone } from './drone.js';

// Minecraft (Java) creative-mode flight, 1 block = 1 m. Always flying: at street level the data has no detail.
const WIDTH_R = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const STEP = 0.6;
const SPEED_SCALE = 2; // Minecraft speeds feel slow at city scale
const SPEED = Object.fromEntries(Object.entries({ fly: 10.92, flySprint: 21.78, flyVert: 7.5 }).map(([k, v]) => [k, v * SPEED_SCALE]));
export const SPEED_STEPS = [1, 2, 4, 8, 16, 32, 64];
const DOUBLE_TAP = 300;
const EPS = 1e-3;
// keys that would otherwise scroll the page or move focus
const NO_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

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
    this.noclip = false;
    this.sprinting = false;
    this.onGround = false;
    this.speedIdx = SPEED_STEPS.indexOf(4); // default ×4
    this.lookSens = 1; // multiplies mouse, touch and controller look
    this.keys = new Set();
    // analog controller input, see gamepad.js; thr / yaw / pitch / roll for the drone
    this.pad = { fwd: 0, str: 0, up: 0, down: 0, thr: 0, yaw: 0, pitch: 0, roll: 0 };
    this.drone = new Drone();
    this.droneOn = false; // gamepad.js: FPV drone controls with a controller connected
    this.droneWas = false;
    this.touchVel = new THREE.Vector3(); // flight from touch gestures, see touch.js
    this.touchSnap = false; // touch.js: velocity follows touchVel without easing (no drift after a gesture)
    this.baseFov = camera.fov;
    this.lastW = 0;
    this.locked = false;
    // soft: playing without pointer lock (after the user's own Esc the browser wants a click before it locks
    // again); the cursor is hidden and mouse look uses plain mouse movement until that click
    this.soft = false;
    this.onToggle = () => {};

    camera.rotation.order = 'YXZ';

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) this.setSoft(false);
      else this.keys.clear();
      this.onToggle(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      const s = 0.0022 * this.lookSens;
      this.look(-e.movementX * s, -e.movementY * s);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.changeSpeed(e.deltaY < 0 ? 1 : -1);
      },
      { passive: true }
    );
    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (NO_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        const now = performance.now();
        if (e.code === 'KeyW' || e.code === 'ArrowUp') {
          if (now - this.lastW < DOUBLE_TAP) this.sprinting = true;
          this.lastW = now;
        }
        if (e.code === 'KeyR') this.sprinting = true; // not Ctrl: Ctrl+W closes the tab
        if (e.code === 'KeyN') this.toggleNoclip();
      }
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Taking game input: pointer locked or soft play. */
  get active() {
    return this.locked || this.soft;
  }

  setSoft(on) {
    this.soft = on;
    document.body.classList.toggle('soft-play', on);
  }

  look(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch + dPitch));
  }

  toggleNoclip() {
    this.noclip = !this.noclip;
  }

  changeSpeed(d) {
    this.speedIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, this.speedIdx + d));
  }

  get speedMult() {
    return SPEED_STEPS[this.speedIdx];
  }

  lock() {
    if (!this.dom.requestPointerLock) return; // e.g. phones: soft play only
    const p = this.dom.requestPointerLock({ unadjustedMovement: true });
    // without a click after the user's own Esc the browser refuses; soft play covers that
    if (p && p.catch) p.catch(() => this.dom.requestPointerLock()?.catch?.(() => {}));
  }

  teleport(x, z, yAboveGround = 60) {
    this.pos.set(x, NaN, z);
    this.pendingHeight = yAboveGround;
    this.vel.set(0, 0, 0);
    this.droneWas = false; // the drone starts level, facing the new view
  }

  update(dt) {
    if (Number.isNaN(this.pos.y)) {
      const g = this.terrain.heightAt(this.pos.x, this.pos.z);
      if (g === null) return this.syncCamera(dt);
      this.pos.y = g + this.pendingHeight;
    }

    if (this.droneOn) {
      if (!this.droneWas) this.drone.reset(this.yaw);
      this.sprinting = false;
      // paused in the menu: hang in the air
      if (this.active) this.drone.update(dt, this.pad, this.vel, this.speedMult, this.onGround);
      else this.vel.set(0, 0, 0);
    } else this.fly(dt);
    this.droneWas = this.droneOn;

    // don't fall through ground that hasn't streamed in yet
    if (this.terrain.heightAt(this.pos.x, this.pos.z) === null) this.vel.set(0, 0, 0);

    const dist = this.vel.length() * dt;
    const n = Math.min(80, Math.max(1, Math.ceil(dist / 0.2)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h);

    this.syncCamera(dt);
  }

  /** Creative-mode flight from keys, sticks and touch. */
  fly(dt) {
    const k = this.keys;
    const pad = this.pad, tv = this.touchVel;
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const key = (...codes) => (codes.some((c) => k.has(c)) ? 1 : 0);
    const fwd = clamp1(key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown') + pad.fwd);
    const str = clamp1(key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft') + pad.str);
    if (fwd <= 0) this.sprinting = false;
    const upAmt = Math.max(key('Space', 'PageUp'), pad.up);
    const downAmt = Math.max(key('ShiftLeft', 'ShiftRight', 'PageDown'), pad.down);

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * str;
    let wz = -cos * fwd - sin * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) (wx /= wl), (wz /= wl); // keys: diagonal; sticks: keep partial deflection

    const m = this.speedMult;
    const sp = (this.sprinting ? SPEED.flySprint : SPEED.fly) * m;
    const a = this.touchSnap ? 1 : 1 - Math.exp(-dt * 6);
    this.vel.x += (wx * sp + tv.x - this.vel.x) * a;
    this.vel.z += (wz * sp + tv.z - this.vel.z) * a;
    this.vel.y += ((upAmt - downAmt) * SPEED.flyVert * m + tv.y - this.vel.y) * a;
  }

  syncCamera(dt) {
    const c = this.camera;
    c.position.set(this.pos.x, (Number.isNaN(this.pos.y) ? 400 : this.pos.y) + EYE, this.pos.z);
    if (this.droneOn) {
      // keep yaw / pitch in step for everything else (touch, the URL, leaving drone mode)
      this.drone.camera(c.quaternion);
      this.yaw = c.rotation.y;
      this.pitch = c.rotation.x;
    } else c.rotation.set(this.pitch, this.yaw, 0);
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
  }
}
