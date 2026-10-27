import * as THREE from 'three';

// Touchscreen controls, no on-screen buttons:
//  - one finger drags the map: the scene follows the finger, sliding sideways and forwards / backwards on the
//    level, scaled to how far away what the crosshair points at is
//  - one finger starting inside the faint ring around the crosshair (#look-ring) drags the view like a photo
//    instead (settings invert either axis to steer the crosshair); faster swipes turn disproportionately further
//    (pointer acceleration)
//  - two fingers swiped up / down fly straight down / up, the scene following them (a setting inverts it), twisting them rotates the map
//    around what the crosshair points at, like in map apps; each two-finger gesture locks to whichever of the
//    two it starts with, so a lift never turns into a twist halfway through or vice versa
//  - nothing moves on after the fingers stop or leave; a finger left over from a multi-finger gesture does
//    nothing until all fingers are up
//  - a tap opens the info box for the crosshair, or closes it if it's open (taps on the box itself don't reach
//    the canvas); a two-finger tap acts like Esc
const LOOK = 0.0028; // rad per CSS px at gain 1
const TAP_MS = 300;
const TAP_PX = 12;
const FALLBACK_DIST = 250; // at the sky or beyond the pick range
const RING_R = 48; // CSS px, radius of #look-ring in index.html
const TWIST_MIN_PX = 60; // closer fingers give a noisy angle, so they don't twist by accident
const LOCK_PX = 14; // how far a two-finger gesture moves (lift) or turns (arc per finger) before it's decided

export class TouchControls {
  constructor(dom, { player, camera, aimDistance, onTap, onTwoFingerTap }) {
    this.player = player;
    this.camera = camera;
    this.aimDistance = aimDistance;
    this.onTap = onTap;
    this.onTwoFingerTap = onTwoFingerTap;
    this.pts = new Map(); // identifier -> { x, y, x0, y0 }
    this.pivot = new THREE.Vector3(); // what twisting rotates the map around
    this.pivotDist = FALLBACK_DIST; // how far ahead along the view the pivot lies
    this.dir = new THREE.Vector3();
    this.pendingTurn = 0; // rad to turn left since the last frame, from twisting
    this.pendingSide = 0; // metres to slide right since the last frame
    this.pendingFwd = 0; // metres to fly forwards on the level since the last frame
    this.pendingUp = 0; // metres to fly up since the last frame
    this.turnSpeed = 0; // rad/s to the left
    this.sideSpeed = 0; // m/s to the right
    this.fwdSpeed = 0; // m/s forwards on the level
    this.upSpeed = 0; // m/s up
    this.dragPrev = null; // { x, y } of the dragging finger
    this.dragDist = FALLBACK_DIST;
    this.looking = false; // the single finger started inside the look ring
    this.invertX = false; // setting: looking left / right steers the crosshair instead of dragging the view
    this.invertY = false; // setting: looking up / down steers the crosshair instead of dragging the view
    this.invertLift = false; // setting: swiping two fingers up flies up

    const opts = { passive: false };
    dom.addEventListener('touchstart', (e) => this.start(e), opts);
    dom.addEventListener('touchmove', (e) => this.move(e), opts);
    dom.addEventListener('touchend', (e) => this.end(e), opts);
    dom.addEventListener('touchcancel', (e) => this.end(e), opts);
    // no pinch-zoom of the page, also when a finger lands outside the canvas: browsers (iOS Safari especially)
    // don't always honour user-scalable=no and touch-action
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), opts);
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

  /**
   * The single finger drags from where it is now: the view if it came down inside the look ring, otherwise the
   * map, at the distance of what the crosshair points at.
   */
  beginDrag() {
    const [p] = this.pts.values();
    this.dragPrev = { x: p.x, y: p.y };
    this.looking = Math.hypot(p.x - window.innerWidth / 2, p.y - window.innerHeight / 2) <= RING_R;
    this.lookT = performance.now();
    this.dragDist = Math.max(3, Math.min(3000, this.aimDistance() ?? FALLBACK_DIST));
  }

  beginTwo() {
    const [a, b] = this.pts.values();
    this.angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.midY = (a.y + b.y) / 2;
    this.twoMode = null; // 'lift' or 'twist' once decided
    this.liftAcc = this.twistAcc = 0; // px moved / turned while undecided
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
    if (this.pts.size === 1 && this.maxTouches === 1) this.looking ? this.look() : this.drag();
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

  /** Drags the view, with trackpad-style acceleration: slow drags aim precisely, fast swipes turn around. */
  look() {
    const [p] = this.pts.values();
    const prev = this.dragPrev;
    this.dragPrev = { x: p.x, y: p.y };
    if (!prev) return;
    const now = performance.now();
    const dt = Math.max(1 / 240, (now - this.lookT) / 1000);
    this.lookT = now;
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const v = Math.hypot(dx, dy) / dt;
    const gain = Math.min(4, 0.4 + v / 900) * this.player.lookSens * LOOK;
    this.player.look(dx * gain * (this.invertX ? -1 : 1), dy * gain * (this.invertY ? -1 : 1));
  }

  two() {
    const [a, b] = this.pts.values();
    const sep = Math.hypot(b.x - a.x, b.y - a.y);
    const midY = (a.y + b.y) / 2;
    const dy = midY - this.midY;
    this.midY = midY;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let da = angle - this.angle;
    this.angle = angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (sep < TWIST_MIN_PX) da = 0;

    if (!this.twoMode) {
      this.liftAcc += dy;
      this.twistAcc += (da * sep) / 2;
      const lift = Math.abs(this.liftAcc), twist = Math.abs(this.twistAcc);
      if (Math.max(lift, twist) < LOCK_PX) return;
      this.twoMode = lift > twist ? 'lift' : 'twist';
    }

    if (this.twoMode === 'lift') {
      // like the one-finger drag, the scene follows the fingers (swiping up lowers the view), and a swipe across
      // the screen covers what the screen spans at the aimed distance
      const spanV = 2 * Math.max(3, this.pivotDist) * Math.tan((this.camera.fov * Math.PI) / 360);
      this.pendingUp += (dy / window.innerHeight) * spanV * (this.invertLift ? -1 : 1);
      return;
    }

    // twisting: turn by the fingers' angle (clockwise on screen turns left, so the map turns along); applied
    // smoothed, once per frame, in update()
    this.pendingTurn += da;
  }

  end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) this.pts.delete(t.identifier);
    this.dragPrev = null;
    if (this.pts.size >= 2) this.beginTwo();
    if (this.pts.size) return;
    const tap = !this.moved && e.timeStamp - this.t0 < TAP_MS;
    if (!tap) return;
    if (this.maxTouches === 1) this.onTap();
    else if (this.maxTouches === 2) this.onTwoFingerTap();
  }

  update(dt) {
    const p = this.player;
    const touching = p.active && this.pts.size > 0;
    if (touching) {
      const a = 1 - Math.exp(-dt * 20), k = 1 / Math.max(dt, 1e-3);
      // softer, like the lift: the fingers' angle is noisy and comes in uneven steps
      this.turnSpeed += (this.pendingTurn * k - this.turnSpeed) * (1 - Math.exp(-dt * 12));
      this.sideSpeed += (this.pendingSide * k - this.sideSpeed) * a;
      this.fwdSpeed += (this.pendingFwd * k - this.fwdSpeed) * a;
      // a little softer: touch events and frames don't line up, so the per-frame lift comes in uneven steps
      this.upSpeed += (this.pendingUp * k - this.upSpeed) * (1 - Math.exp(-dt * 12));
    }
    // flight follows the fingers directly, and stops the moment they let go
    p.touchSnap = touching || this.turnSpeed !== 0 || this.sideSpeed !== 0 || this.fwdSpeed !== 0 || this.upSpeed !== 0;
    if (!touching) this.turnSpeed = this.sideSpeed = this.fwdSpeed = this.upSpeed = 0;
    this.pendingTurn = this.pendingSide = this.pendingFwd = this.pendingUp = 0;
    p.touchVel.set(0, this.upSpeed, 0);
    // turning circles on the level around the point the crosshair is on, at the distance it pointed at when the
    // fingers came down, so the map turns around it; the turn and the orbit come from the same smoothed angle
    const da = this.turnSpeed * dt;
    if (da) {
      const pos = this.camera.position;
      this.camera.getWorldDirection(this.pivot).multiplyScalar(this.pivotDist).add(pos);
      p.look(da, 0);
      const c = Math.cos(da), s = Math.sin(da);
      const rx = pos.x - this.pivot.x, rz = pos.z - this.pivot.z;
      p.touchVel.x += (rx * c + rz * s - rx) / dt;
      p.touchVel.z += (-rx * s + rz * c - rz) / dt;
    }
    // same directions as D and W in player.js
    p.touchVel.x += Math.cos(p.yaw) * this.sideSpeed - Math.sin(p.yaw) * this.fwdSpeed;
    p.touchVel.z -= Math.sin(p.yaw) * this.sideSpeed + Math.cos(p.yaw) * this.fwdSpeed;
  }
}
