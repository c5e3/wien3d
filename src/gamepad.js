// Bluetooth/USB controllers via the Gamepad API ("standard" mapping: Xbox / PlayStation / Switch Pro layout).
// Sticks and triggers feed player.pad every frame; button presses go to onPress(index) for main.js to map.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.15;
const DEAD_DRONE = 0.08; // drone: small tilts matter
const DEAD_TRIGGER = 0.05; // worn triggers rest slightly pressed
const LOOK = 3; // rad/s at full deflection

export class Gamepads {
  constructor(player) {
    this.player = player;
    this.prev = [];
    this.onPress = () => {};
    this.current = null; // the controller in use, for the stats box and settings
    this.invertY = false;
    this.swapUpDown = false; // LT up, RT down
    this.swapSticks = false; // left-handed: look with the left stick, move with the right
    // FPV drone, mode 2: left stick throttle / yaw, right stick pitch / roll; see drone.js
    this.drone = false;
  }

  update(dt) {
    const p = this.player;
    p.pad.fwd = p.pad.str = p.pad.up = p.pad.down = 0;
    p.pad.thr = p.pad.yaw = p.pad.pitch = p.pad.roll = 0;
    // the most recently used one: on Windows the first slot is often a virtual or non-gamepad HID device
    let pad = null;
    for (const g of navigator.getGamepads?.() || []) if (g?.connected && (!pad || g.timestamp > pad.timestamp)) pad = g;
    if (pad?.index !== this.current?.index) this.prev = [];
    this.current = pad;
    p.droneOn = this.drone && !!pad;
    if (!pad) return;

    pad.buttons.forEach((b, i) => {
      if (b.pressed && !this.prev[i]) this.onPress(i);
      this.prev[i] = b.pressed;
    });
    if (!p.active) return;

    const axis = (i, dead = DEAD) => {
      const v = pad.axes[i] || 0, a = Math.abs(v);
      return a < dead ? 0 : (Math.sign(v) * (a - dead)) / (1 - dead);
    };
    const btn = (i) => pad.buttons[i]?.value || 0;
    // triggers are analog (0..1): half pressed climbs / sinks at half speed
    const trigger = (i) => Math.max(0, btn(i) - DEAD_TRIGGER) / (1 - DEAD_TRIGGER);
    if (this.drone) {
      const [t, r] = this.swapSticks ? [2, 0] : [0, 2]; // throttle / yaw stick, pitch / roll stick
      const ax = (i) => axis(i, DEAD_DRONE);
      p.pad.thr = -ax(t + 1);
      p.pad.yaw = ax(t);
      p.pad.pitch = -ax(r + 1) * (this.invertY ? -1 : 1); // stick forwards tips the nose down
      p.pad.roll = ax(r);
      return;
    }
    const [m, l] = this.swapSticks ? [2, 0] : [0, 2];
    p.pad.str = axis(m);
    p.pad.fwd = -axis(m + 1);
    // squared response: fine aiming near the centre, fast turns at full tilt
    const rx = axis(l), ry = axis(l + 1) * (this.invertY ? -1 : 1);
    const s = LOOK * p.lookSens * dt;
    p.look(-Math.sign(rx) * rx * rx * s, -Math.sign(ry) * ry * ry * s);
    const [up, down] = this.swapUpDown ? [BTN.LT, BTN.RT] : [BTN.RT, BTN.LT];
    p.pad.up = Math.max(btn(BTN.A), trigger(up));
    p.pad.down = trigger(down);
  }
}
