import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lonLatToWorld } from './geo.js';

// Wiener Riesenrad (1897), modelled by hand to scale: neither the city's building data nor the LOD2 roofs
// contain it. Position and orientation from its OpenStreetMap outline (way 97979331, © OpenStreetMap
// contributors, ODbL), dimensions from Wikipedia: 64.75 m high, 30-sided wheel, 60.96 m across the gondola
// suspension axes, rim truss 55.78 / 49.68 m, axle 10.78 m, 15 gondolas, 0.75 m/s at the rim.
const OUTLINE = [ // lon, lat: the long sides run along the wheel's plane
  [16.3958834, 48.2169251], [16.3959939, 48.2169169], [16.3959026, 48.21637], [16.3957921, 48.2163782],
];
const TOP = 64.75;
const R_SUSP = 60.96 / 2;
const R_OUT = 55.78 / 2;
const R_IN = 49.68 / 2;
const AXLE_Y = TOP - R_SUSP; // above ground
const AXLE_LEN = 10.78;
const SIDES = 30;
const RIM_Z = 3.1; // the two rim planes, either side of the wheel's centre plane
const FLANGE_Z = AXLE_LEN / 2 - 1.4; // clear of the bearings
const GONDOLAS = 15;
const OMEGA = 0.75 / R_SUSP; // rad/s: one turn in about 255 s

const steel = new THREE.MeshLambertMaterial({ color: 0x4d4a46 });
const cable = new THREE.LineBasicMaterial({ color: 0x3a3835, transparent: true, opacity: 0.8 });
const red = new THREE.MeshLambertMaterial({ color: 0xa11d22 });
const windowMat = new THREE.MeshLambertMaterial({ color: 0xe9e1cc });
const roofMat = new THREE.MeshLambertMaterial({ color: 0x3b302b });

const UP = new THREE.Vector3(0, 1, 0);
/** Box of section w x w from a to b. */
function beam(a, b, w) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(w, d.length(), w);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
const at = (r, i, z) => {
  const a = (i / SIDES) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
};

/** The rotating wheel, centred on the axle: x/y span the wheel plane, z runs along the axle. */
function wheel() {
  const parts = [];
  for (const z of [-RIM_Z, RIM_Z])
    for (let i = 0; i < SIDES; i++) {
      // rim truss: outer and inner chord, posts and diagonals
      parts.push(beam(at(R_OUT, i, z), at(R_OUT, i + 1, z), 0.5), beam(at(R_IN, i, z), at(R_IN, i + 1, z), 0.45));
      parts.push(beam(at(R_IN, i, z), at(R_OUT, i, z), 0.3), beam(at(R_IN, i, z), at(R_OUT, i + 1, z), 0.22));
      // bracket out to the gondola suspension axis
      parts.push(beam(at(R_OUT, i, z), at(R_SUSP, i, z), 0.35), beam(at(R_OUT, i + 1, z), at(R_SUSP, i, z), 0.25));
    }
  // the suspension axes are the only links between the rim planes: at the top of the turn a wagon hangs
  // inwards between them
  for (let i = 0; i < SIDES; i++) parts.push(beam(at(R_SUSP, i, -RIM_Z), at(R_SUSP, i, RIM_Z), 0.3));
  const hub = new THREE.CylinderGeometry(0.5, 0.5, AXLE_LEN, 16).rotateX(Math.PI / 2);
  const f1 = new THREE.CylinderGeometry(2.2, 2.2, 0.5, 24).rotateX(Math.PI / 2).translate(0, 0, FLANGE_Z);
  const f2 = f1.clone().translate(0, 0, -2 * FLANGE_Z);
  parts.push(hub, f1, f2);
  const structure = new THREE.Mesh(mergeGeometries(parts), steel);

  // spokes: tension cables from both hub flanges to both rim planes, crossing
  const pts = [];
  for (let i = 0; i < SIDES; i++)
    for (const fz of [-FLANGE_Z, FLANGE_Z])
      for (const rz of [-RIM_Z, RIM_Z]) pts.push(at(2.2, i + (fz > 0 ? 0.25 : -0.25), fz), at(R_IN, i, rz));
  const spokes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), cable);

  const g = new THREE.Group();
  g.add(structure, spokes);
  return { group: g, structure };
}

/** The fixed support: on each side four lattice legs carrying an axle bearing. */
function support() {
  const parts = [];
  for (const s of [-1, 1]) {
    const top = new THREE.Vector3(0, AXLE_Y - 1, s * (AXLE_LEN / 2 - 0.2));
    const feet = [[-17, 6.5], [-12, 9.5], [12, 9.5], [17, 6.5]].map(([x, z]) => new THREE.Vector3(x, -1, s * z));
    for (const f of feet) parts.push(beam(top, f, 1.1));
    // horizontal braces between the legs
    for (const h of [0.3, 0.6]) {
      const p = feet.map((f) => new THREE.Vector3().lerpVectors(f, top, h));
      for (let i = 0; i < 3; i++) parts.push(beam(p[i], p[i + 1], 0.45));
    }
    parts.push(new THREE.BoxGeometry(2.6, 2.2, 1.6).translate(0, AXLE_Y, s * (AXLE_LEN / 2 - 0.2))); // bearing
  }
  return new THREE.Mesh(mergeGeometries(parts), steel);
}

/** One wagon, origin at its suspension pin: red body, window band, roof. */
const GONDOLA_PARTS = (() => {
  const L = 5.4, W = 2.3, H = 2.5, top = -0.6; // L along the axle
  return [
    [new THREE.BoxGeometry(W, H, L).translate(0, top - 0.35 - H / 2, 0), red],
    [new THREE.BoxGeometry(W + 0.06, 0.95, L - 0.6).translate(0, top - 0.35 - 0.8, 0), windowMat],
    [new THREE.BoxGeometry(W + 0.4, 0.35, L + 0.4).translate(0, top - 0.175, 0), roofMat],
    [new THREE.BoxGeometry(0.15, 0.6, 0.15).translate(0, -0.3, -L / 3), roofMat],
    [new THREE.BoxGeometry(0.15, 0.6, 0.15).translate(0, -0.3, L / 3), roofMat],
  ];
})();
function gondola() {
  const g = new THREE.Group();
  for (const [geo, mat] of GONDOLA_PARTS) g.add(new THREE.Mesh(geo, mat));
  return g;
}

export class Riesenrad {
  constructor({ scene, terrain }) {
    this.terrain = terrain;
    const [x0, z0] = lonLatToWorld(...OUTLINE[0]), [x1, z1] = lonLatToWorld(...OUTLINE[1]);
    const [x2, z2] = lonLatToWorld(...OUTLINE[2]), [x3, z3] = lonLatToWorld(...OUTLINE[3]);
    this.x = (x0 + x1 + x2 + x3) / 4;
    this.z = (z0 + z1 + z2 + z3) / 4;
    // local x along the wheel plane (outline's long side), local z along the axle
    const ux = (x0 + x1) / 2 - (x2 + x3) / 2, uz = (z0 + z1) / 2 - (z2 + z3) / 2;

    this.root = new THREE.Group();
    this.root.rotation.y = Math.atan2(-uz, ux);
    this.root.visible = false; // until the terrain under it is known
    const w = wheel();
    this.wheel = w.group;
    this.wheel.position.y = AXLE_Y;
    this.gondolas = Array.from({ length: GONDOLAS }, gondola);
    const sup = support();
    this.root.add(this.wheel, sup, ...this.gondolas);
    scene.add(this.root);
    this.angle = 0;
    this.placed = false;

    this.pickables = [w.structure, sup, ...this.gondolas.flatMap((g) => g.children)];
    for (const o of this.pickables) o.userData.pick = 'riesenrad';
  }

  update(dt) {
    if (!this.placed) {
      const g = this.terrain.heightAt(this.x, this.z);
      if (g === null) return;
      this.root.position.set(this.x, g, this.z);
      this.root.visible = this.placed = true;
    }
    this.angle = (this.angle + OMEGA * dt) % (Math.PI * 2);
    this.wheel.rotation.z = this.angle;
    // wagons hang from every second suspension axis and stay level
    this.gondolas.forEach((g, i) => {
      const a = this.angle + (i * 2 * Math.PI) / GONDOLAS;
      g.position.set(Math.cos(a) * R_SUSP, AXLE_Y + Math.sin(a) * R_SUSP, 0);
    });
  }
}
