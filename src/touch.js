import * as THREE from 'three';

// Touchscreen controls, no on-screen buttons:
//  - one finger drags the map: the scene follows the finger, sliding sideways and forwards / backwards on the
//    level, scaled to how far away what the crosshair points at is
//  - two fingers moving together drag the view like a photo (settings invert either axis to steer the crosshair
//    instead); faster swipes turn disproportionately further (pointer acceleration)
//  - twisting two fingers rotates the map around what the crosshair points at, like in map apps
//  - nothing moves on after the fingers stop or leave; a finger left over from a multi-finger gesture does
//    nothing until all fingers are up
//  - a double tap opens the info box for the crosshair, a two-finger tap acts like Esc, a three-finger tap opens
//    the POI list
const LOOK = 0.0028; // rad per CSS px at gain 1
const TAP_MS = 300;
const TAP_PX = 12;
const DOUBLE_MS = 350; // between the end of the first tap and the end of the second
const DOUBLE_PX = 40;
const FALLBACK_DIST = 250; // at the sky or beyond the pick range

export class TouchControls {
  constructor(dom, { player, camera, aimDistance, onDoubleTap, onTwoFingerTap, onThreeFingerTap }) {
    this.player = player;
    this.camera = camera;
    this.aimDistance = aimDistance;
    this.onDoubleTap = onDoubleTap;
    this.onTwoFingerTap = onTwoFingerTap;
    this.onThreeFingerTap = onThreeFingerTap;
    this.pts = new Map(); // identifier -> { x, y, x0, y0 }
    this.pivot = new THREE.Vector3(); // what twisting rotates the map around
    this.pivotDist = FALLBACK_DIST; // how far ahead along the view the pivot lies
    this.dir = new THREE.Vector3();
    this.pendingX = 0; // metres to move east (world x) since the last frame, from twisting
    this.pendingZ = 0; // metres to move in world z since the last frame, from twisting
    this.pendingSide = 0; // metres to slide right since the last frame
    this.pendingFwd = 0; // metres to fly forwards on the level since the last frame
    this.vx = 0; // m/s in world x
    this.vz = 0; // m/s in world z
    this.sideSpeed = 0; // m/s to the right
    this.fwdSpeed = 0; // m/s forwards on the level
    this.dragPrev = null; // { x, y } of the dragging finger
    this.dragDist = FALLBACK_DIST;
    this.lastTap = null; // { t, x, y } of the last one-finger tap, for double taps
    this.invertX = false; // setting: two fingers left / right steer the crosshair instead of dragging the view
    this.invertY = false; // setting: two fingers up / down steer the crosshair instead of dragging the view

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
    this.dragPrev = null;
    if (this.pts.size >= 2) this.beginTwo();
    else this.beginDrag();
  }

  /** The single finger drags from where it is now, at the distance of what the crosshair points at. */
  beginDrag() {
    const [p] = this.pts.values();
    this.dragPrev = { x: p.x, y: p.y };
    this.dragDist = Math.max(3, Math.min(3000, this.aimDistance() ?? FALLBACK_DIST));
  }

  beginTwo() {
    const [a, b] = this.pts.values();
    this.angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.midX = (a.x + b.x) / 2;
    this.midY = (a.y + b.y) / 2;
    this.twoT = performance.now();
    this.pivotDist = Math.min(3000, this.aimDistance() ?? FALLBACK_DIST);
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
    // a finger left over from a multi-finger gesture doesn't drag: fingers rarely lift at exactly the same time
    if (this.pts.size === 1 && this.maxTouches === 1) this.drag();
    else if (this.pts.size >= 2) this.two();
  }

  drag() {
    const [p] = this.pts.values();
    const prev = this.dragPrev;
    this.dragPrev = { x: p.x, y: p.y };
    if (!prev) return;
    const cam = this.camera;
    // the screen spans 2·dist·tan(fov/2) at the target's distance; sideways that's what the finger moved, forwards
    // the ground is foreshortened by the view's tilt (capped, so a level view doesn't shoot off to the horizon)
    const spanV = 2 * this.dragDist * Math.tan((cam.fov * Math.PI) / 360);
    const tilt = Math.max(0.3, -cam.getWorldDirection(this.dir).y);
    this.pendingSide -= ((p.x - prev.x) / window.innerHeight) * spanV;
    this.pendingFwd += ((p.y - prev.y) / window.innerHeight) * (spanV / tilt);
  }

  two() {
    const [a, b] = this.pts.values();
    const now = performance.now();
    const dt = Math.max(1 / 240, (now - this.twoT) / 1000);
    this.twoT = now;

    // fingers moving together drag the view, with trackpad-style acceleration: slow drags aim precisely, fast
    // swipes turn around
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    const dx = midX - this.midX, dy = midY - this.midY;
    this.midX = midX;
    this.midY = midY;
    const v = Math.hypot(dx, dy) / dt;
    const gain = Math.min(4, 0.4 + v / 900) * this.player.lookSens * LOOK;
    this.player.look(dx * gain * (this.invertX ? -1 : 1), dy * gain * (this.invertY ? -1 : 1));

    // twisting: turn by the fingers' angle (clockwise on screen turns left, so the map turns along) and circle on
    // the level around the point the crosshair is on, at the distance it pointed at when the fingers came down
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let da = angle - this.angle;
    this.angle = angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (!da) return;
    const pos = this.camera.position;
    this.camera.getWorldDirection(this.pivot).multiplyScalar(this.pivotDist).add(pos);
    this.player.look(da, 0);
    const c = Math.cos(da), s = Math.sin(da);
    const rx = pos.x - this.pivot.x, rz = pos.z - this.pivot.z;
    this.pendingX += rx * c + rz * s - rx;
    this.pendingZ += -rx * s + rz * c - rz;
  }

  end(e) {
    e.preventDefault();
    let last = null;
    for (const t of e.changedTouches) {
      last = this.pts.get(t.identifier) ?? last;
      this.pts.delete(t.identifier);
    }
    this.dragPrev = null;
    if (this.pts.size >= 2) this.beginTwo();
    if (this.pts.size) return;
    const tap = !this.moved && e.timeStamp - this.t0 < TAP_MS;
    if (tap && this.maxTouches === 1 && last) {
      const prev = this.lastTap;
      if (prev && e.timeStamp - prev.t < DOUBLE_MS && Math.hypot(last.x - prev.x, last.y - prev.y) < DOUBLE_PX) {
        this.lastTap = null;
        this.onDoubleTap();
      } else this.lastTap = { t: e.timeStamp, x: last.x, y: last.y };
      return;
    }
    this.lastTap = null;
    if (!tap) return;
    if (this.maxTouches === 2) this.onTwoFingerTap();
    else if (this.maxTouches === 3) this.onThreeFingerTap();
  }

  update(dt) {
    const p = this.player;
    const touching = p.active && this.pts.size > 0;
    if (touching) {
      const a = 1 - Math.exp(-dt * 20), k = 1 / Math.max(dt, 1e-3);
      this.vx += (this.pendingX * k - this.vx) * a;
      this.vz += (this.pendingZ * k - this.vz) * a;
      this.sideSpeed += (this.pendingSide * k - this.sideSpeed) * a;
      this.fwdSpeed += (this.pendingFwd * k - this.fwdSpeed) * a;
    }
    // flight follows the fingers directly, and stops the moment they let go
    p.touchSnap = touching || this.vx !== 0 || this.vz !== 0 || this.sideSpeed !== 0 || this.fwdSpeed !== 0;
    if (!touching) this.vx = this.vz = this.sideSpeed = this.fwdSpeed = 0;
    this.pendingX = this.pendingZ = this.pendingSide = this.pendingFwd = 0;
    p.touchVel.set(this.vx, 0, this.vz);
    // same directions as D and W in player.js
    p.touchVel.x += Math.cos(p.yaw) * this.sideSpeed - Math.sin(p.yaw) * this.fwdSpeed;
    p.touchVel.z -= Math.sin(p.yaw) * this.sideSpeed + Math.cos(p.yaw) * this.fwdSpeed;
  }
}
