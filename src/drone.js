import * as THREE from 'three';

// FPV quadcopter in a self-levelling (angle) mode: the right stick sets how far the drone tilts, and letting go
// levels it out again, so it can't flip or end up upside down. Like a real quad it only makes thrust along its own
// up axis: tilting forwards is what flies it forwards, and the view tilts and banks with it.
//  - throttle: gamepad sticks spring back to the centre, so the centre holds the height (thrust makes up for the
//    tilt), up climbs, down sinks
//  - yaw turns at a rate, slow near the centre
const G = 9.81;
const CLIMB = 1; // extra g at full throttle
const SINK = 0.7; // g taken away at zero throttle
const MAX_TILT = THREE.MathUtils.degToRad(40);
const LEVEL = 6; // 1/s: how quickly the attitude follows the stick
const UPTILT = THREE.MathUtils.degToRad(10); // camera tilted up a little, as on FPV quads
const YAW = { center: 60, max: 200, expo: 0.3 }; // °/s
const DRAG_LIN = 0.1;
const DRAG_QUAD = 0.03; // top speed ≈ 15 m/s × the speed multiplier
const GROUND_FRICTION = 8;

// Betaflight "actual" rates
function rate(x, r) {
  const expof = Math.abs(x) * (x ** 5 * r.expo + x * (1 - r.expo));
  return THREE.MathUtils.degToRad(x * r.center + Math.max(0, r.max - r.center) * expof);
}

const _up = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), UPTILT);

export class Drone {
  constructor() {
    this.yaw = 0;
    this.pitch = 0; // > 0: nose down
    this.roll = 0; // > 0: banked right
  }

  /** Level, nose towards yaw. */
  reset(yaw) {
    this.yaw = yaw;
    this.pitch = this.roll = 0;
  }

  attitude(out) {
    return out.setFromEuler(_e.set(-this.pitch, this.yaw, -this.roll, 'YXZ'));
  }

  /** input: { thr, yaw, pitch, roll } in -1..1, pitch > 0 tips the nose down; k scales the forces (speed ×1 = 1). */
  update(dt, input, vel, k, onGround) {
    this.yaw -= rate(input.yaw, YAW) * dt;
    const a = 1 - Math.exp(-dt * LEVEL);
    this.pitch += (input.pitch * MAX_TILT - this.pitch) * a;
    this.roll += (input.roll * MAX_TILT - this.roll) * a;

    _up.set(0, 1, 0).applyQuaternion(this.attitude(_q));
    const lift = input.thr >= 0 ? 1 + CLIMB * input.thr : 1 + SINK * input.thr; // vertical, in g
    vel.addScaledVector(_up, ((lift * G * k) / _up.y) * dt);
    vel.y -= G * k * dt;
    const drag = DRAG_LIN + (DRAG_QUAD * vel.length()) / k;
    vel.multiplyScalar(Math.max(0, 1 - drag * dt));
    if (onGround) {
      const f = Math.exp(-dt * GROUND_FRICTION);
      vel.x *= f;
      vel.z *= f;
    }
  }

  /** The FPV camera's orientation. */
  camera(out) {
    return this.attitude(out).multiply(TILT);
  }
}
