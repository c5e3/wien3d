import * as THREE from 'three';

// Touchscreen controls, no on-screen buttons:
//  - one finger steers the crosshair like a trackpad; faster swipes turn disproportionately further
//    (pointer acceleration), a flick keeps spinning briefly
//  - pinching flies towards what the crosshair points at, spreading backs away; each step is a fraction of the
//    distance to that point, so far targets come quickly and near ones gently, and the flight glides out
//  - a tap opens the info box for the crosshair, a two-finger tap acts like Esc
const LOOK = 0.0028; // rad per CSS px at gain 1
const TAP_MS = 280;
const TAP_PX = 12;
const FALLBACK_DIST = 250; // pinching at the sky or beyond the pick range
const GLIDE = 2.2; // 1/s decay of flight after the fingers leave
const SPIN_DECAY = 6; // 1/s decay of a look flick

export class TouchControls {
  constructor(dom, { player, camera, aimDistance, onTap, onTwoFingerTap }) {
    this.player = player;
    this.camera = camera;
    this.aimDistance = aimDistance;
    this.onTap = onTap;
    this.onTwoFingerTap = onTwoFingerTap;
    this.pts = new Map(); // identifier -> { x, y, x0, y0 }
    this.target = new THREE.Vector3();
    this.pinchDist = 0;
    this.pending = 0; // metres to fly along the view since the last frame
    this.speed = 0; // m/s along the view
    this.spin = { yaw: 0, pitch: 0, t: 0 }; // rad/s of the last look swipe
    this.lookPrev = null; // { x, y, t } of the steering finger
    this.dragView = false; // setting: drag the scene like a photo instead of steering the crosshair
    this.spreadToApproach = false; // setting: map-app style, spreading flies closer

    const opts = { passive: false };
    dom.addEventListener('touchstart', (e) => this.start(e), opts);
    dom.addEventListener('touchmove', (e) => this.move(e), opts);
    dom.addEventListener('touchend', (e) => this.end(e), opts);
    dom.addEventListener('touchcancel', (e) => this.end(e), opts);
    // iOS Safari pinch-zooms the page despite touch-action
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  start(e) {
    e.preventDefault(); // no emulated mouse events, no page zoom
    if (!this.pts.size) {
      this.t0 = e.timeStamp;
      this.maxTouches = 0;
      this.moved = false;
    }
    for (const t of e.changedTouches) this.pts.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY });
    this.maxTouches = Math.max(this.maxTouches, this.pts.size);
    // a finger down catches any glide or spin
    this.speed = 0;
    this.spin.yaw = this.spin.pitch = 0;
    this.lookPrev = null;
    if (this.pts.size >= 2) this.beginPinch();
    else this.anchorLook(e.timeStamp);
  }

  /** The (remaining) single finger steers from where it is now. */
  anchorLook(now) {
    const [p] = this.pts.values();
    this.lookPrev = { x: p.x, y: p.y, t: now };
  }

  beginPinch() {
    const [a, b] = this.pts.values();
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchT = performance.now();
    const d = this.aimDistance() ?? FALLBACK_DIST;
    this.camera.getWorldDirection(this.target);
    this.target.multiplyScalar(d).add(this.camera.position);
  }

  move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = this.pts.get(t.identifier);
      if (!p) continue;
      p.x = t.clientX;
      p.y = t.clientY;
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_PX) this.moved = true;
    }
    if (!this.player.active) return;
    if (this.pts.size === 1) this.look(e.timeStamp);
    else if (this.pts.size >= 2) this.pinch();
  }

  look(now) {
    const [p] = this.pts.values();
    const prev = this.lookPrev;
    this.lookPrev = { x: p.x, y: p.y, t: now };
    if (!prev) return;
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const dt = Math.max(1 / 240, (now - prev.t) / 1000);
    // trackpad-style acceleration: slow drags aim precisely, fast swipes turn around
    const v = Math.hypot(dx, dy) / dt;
    const gain = Math.min(4, 0.4 + v / 900) * this.player.lookSens * (this.dragView ? -1 : 1);
    const yaw = -dx * LOOK * gain, pitch = -dy * LOOK * gain;
    this.player.look(yaw, pitch);
    const k = 0.5; // smooth the flick velocity over the last few events
    this.spin.yaw += (yaw / dt - this.spin.yaw) * k;
    this.spin.pitch += (pitch / dt - this.spin.pitch) * k;
    this.spin.t = now;
  }

  pinch() {
    const [a, b] = this.pts.values();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!this.pinchDist || !d) return;
    const now = performance.now();
    const dt = Math.max(1 / 240, (now - this.pinchT) / 1000);
    const s = this.spreadToApproach ? this.pinchDist / d : d / this.pinchDist;
    this.pinchDist = d;
    this.pinchT = now;
    // the faster the pinch, the larger the share of the distance it covers
    const g = 1 + Math.min(4, (Math.abs(Math.log(s)) / dt) * 0.6);
    const dist = Math.max(3, Math.min(3000, this.camera.position.distanceTo(this.target)));
    const step = s < 1 ? dist * (1 - s ** g) : -dist * (s ** g - 1);
    this.pending += Math.max(-dist, Math.min(dist * 0.5, step));
  }

  end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) this.pts.delete(t.identifier);
    this.lookPrev = null;
    if (this.pts.size >= 2) this.beginPinch();
    else if (this.pts.size === 1) this.anchorLook(e.timeStamp);
    if (this.pts.size) return;
    if (!this.moved && e.timeStamp - this.t0 < TAP_MS) {
      this.spin.yaw = this.spin.pitch = 0;
      if (this.maxTouches === 1) this.onTap();
      else if (this.maxTouches === 2) this.onTwoFingerTap();
      return;
    }
    // only a swipe that was still moving when the finger left keeps spinning
    if (e.timeStamp - this.spin.t > 60 || this.maxTouches > 1) this.spin.yaw = this.spin.pitch = 0;
  }

  update(dt) {
    const p = this.player;
    if (!p.active) {
      this.pending = this.speed = this.spin.yaw = this.spin.pitch = 0;
      p.touchVel.set(0, 0, 0);
      return;
    }
    if (this.pts.size >= 2) {
      this.speed += (this.pending / Math.max(dt, 1e-3) - this.speed) * (1 - Math.exp(-dt * 20));
      this.pending = 0;
    } else {
      this.speed *= Math.exp(-dt * GLIDE);
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
    if (!this.pts.size && (this.spin.yaw || this.spin.pitch)) {
      p.look(this.spin.yaw * dt, this.spin.pitch * dt);
      const f = Math.exp(-dt * SPIN_DECAY);
      this.spin.yaw *= f;
      this.spin.pitch *= f;
      if (Math.hypot(this.spin.yaw, this.spin.pitch) < 0.02) this.spin.yaw = this.spin.pitch = 0;
    }
    this.camera.getWorldDirection(p.touchVel).multiplyScalar(this.speed);
  }
}
