import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Low-poly Wiener Linien vehicles, modelled by hand from public dimensions and photos (no 3D data is published).
// Each model is a list of cars that follow the track or road on their own pivots (bogies, axles), so long trams
// and articulated buses bend around curves. Car geometry: +x = forwards, origin at the centre between the
// pivots, y = 0 on the rail head / road.
//
// Line -> vehicle: the newest type in service on each line (state of 2026, see lineModel). Sources:
// Wiener Linien press releases, de.wikipedia "Straßenbahn Wien" (vehicle types per line),
// "Busverkehr in Wien" (bus types per line), "Lokalbahn Wien–Baden" (Reihe 500).

const C = {
  red: 0xd0101b, darkRed: 0x9e0d15, glass: 0x1c232b, roof: 0xa9abab, roofDark: 0x6d6f70, skirt: 0x2b2b2d, black: 0x141416,
  white: 0xeeefed, silver: 0xc9cdd0, grey: 0x7c8186, wlbBlue: 0x0060a8, wlbLight: 0xe9edf0, tyre: 0x1a1a1a, door: 0x3a3f45,
};

const col = new THREE.Color();
/** Hexahedron from 8 corners (bottom 4 then top 4, both counter-clockwise from above), flat shaded. */
function hex(c, color) {
  const [a, b, cc, d, e, f, g, h] = c;
  const tris = [
    [a, cc, b], [a, d, cc], // bottom
    [e, f, g], [e, g, h], // top
    [a, b, f], [a, f, e], [b, cc, g], [b, g, f], [cc, d, h], [cc, h, g], [d, a, e], [d, e, h],
  ];
  const pos = [];
  for (const t of tris) for (const p of t) pos.push(p[0], p[1], p[2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  col.setHex(color);
  const cols = new Float32Array(pos.length);
  for (let i = 0; i < cols.length; i += 3) (cols[i] = col.r), (cols[i + 1] = col.g), (cols[i + 2] = col.b);
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}
/** Axis-aligned box x0..x1, y0..y1, half width hw (optionally narrower at the top: hwTop). */
function box(x0, x1, y0, y1, hw, color, hwTop = hw) {
  return hex([[x0, y0, hw], [x1, y0, hw], [x1, y0, -hw], [x0, y0, -hw], [x0, y1, hwTop], [x1, y1, hwTop], [x1, y1, -hwTop], [x0, y1, -hwTop]], color);
}
/** Box whose +x face leans back by `lean` metres at the top (windscreens, noses). */
function nose(x0, x1, y0, y1, hw, color, lean, hwTop = hw) {
  return hex([[x0, y0, hw], [x1, y0, hw], [x1, y0, -hw], [x0, y0, -hw], [x0, y1, hwTop], [x1 - lean, y1, hwTop], [x1 - lean, y1, -hwTop], [x0, y1, -hwTop]], color);
}
function flipped(geo) {
  // mirror front to back, keeping faces outwards
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const p = g.attributes.position.array, c = g.attributes.color.array;
  for (let i = 0; i < p.length; i += 9)
    for (let k = 0; k < 3; k++) {
      [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
      [c[i + 3 + k], c[i + 6 + k]] = [c[i + 6 + k], c[i + 3 + k]];
    }
  g.computeVertexNormals();
  return g;
}

/**
 * A rail or road car body of length L (centred), as layered bands:
 * spec: { w, floor, sill, head, top, roof, colors: { lower, upper, roof, skirt, band? }, stripe?: [y0, y1, color],
 *         front?: 'cab' | 'flat' | 'none', back?: same, cab: { len, lean, color, glassTo }, doors: [x...], doorW,
 *         doorColor, roofKit: [[x0, x1, h, hw, color]...], wheels: [x...] (buses), skirtFrom }
 */
function carBody(L, s) {
  const hw = s.w / 2, parts = [];
  const x0 = -L / 2, x1 = L / 2;
  const cabLen = s.cab?.len ?? 1.6;
  // the cab ends get their own geometry: shorten the side bands there
  const fx = s.front === 'cab' ? x1 - cabLen : x1, bx = s.back === 'cab' ? x0 + cabLen : x0;
  // running gear / skirt
  parts.push(box(x0 + 0.2, x1 - 0.2, s.skirtFrom ?? 0.12, s.floor, hw - 0.12, s.colors.skirt));
  // side bands
  parts.push(box(bx, fx, s.floor, s.sill, hw, s.colors.lower));
  parts.push(box(bx, fx, s.sill, s.head, hw - 0.03, C.glass));
  parts.push(box(bx, fx, s.head, s.top, hw, s.colors.upper));
  parts.push(box(bx, fx, s.top, s.roof, hw - 0.05, s.colors.roof, hw - 0.35));
  if (s.stripe) parts.push(box(bx, fx, s.stripe[0], s.stripe[1], hw + 0.012, s.stripe[2]));
  // window pillars: thin body-coloured posts break the glass band up
  for (let x = bx + (s.pillarStep ?? 1.6); x < fx - 0.3; x += s.pillarStep ?? 1.6) parts.push(box(x - 0.07, x + 0.07, s.sill, s.head, hw + 0.005, s.colors.pillar ?? s.colors.upper));
  // doors: glass panels flush with the side, from the floor up to the window head
  for (const d of s.doors || []) parts.push(box(d - (s.doorW ?? 1.3) / 2, d + (s.doorW ?? 1.3) / 2, s.floor + 0.05, s.head - 0.05, hw + 0.02, s.doorColor ?? C.door));
  // ends
  const end = (kind) => {
    const g = [];
    if (kind === 'cab') {
      const c = s.cab || {}, cx0 = x1 - cabLen, lean = c.lean ?? 0.4;
      g.push(box(cx0, x1, s.floor, c.glassFrom ?? s.sill, hw, c.color ?? s.colors.lower, hw - 0.05));
      g.push(nose(cx0, x1 - 0.05, c.glassFrom ?? s.sill, s.top, hw - 0.04, C.glass, lean, hw - 0.08));
      g.push(nose(cx0, x1 - 0.05 - lean, s.top, s.roof, hw - 0.06, c.capColor ?? s.colors.roof, 0.25, hw - 0.4));
      if (c.stripe) g.push(box(x1 - 0.06, x1 + 0.01, c.stripe[0], c.stripe[1], hw - 0.1, c.stripe[2]));
      // headlights
      for (const z of [hw - 0.4, -(hw - 0.4)]) g.push(box(x1 - 0.02, x1 + 0.03, 0.72, 0.88, 0.14, 0xfff6d8).translate(0, 0, z));
    } else if (kind === 'flat') {
      g.push(box(x1 - 0.05, x1, s.floor, s.roof - 0.05, hw - 0.05, s.colors.lower));
      g.push(box(x1, x1 + 0.02, s.sill, s.head, hw - 0.4, C.glass));
    } else if (kind === 'gangway') {
      g.push(box(x1, x1 + 0.35, s.floor + 0.1, s.top - 0.1, hw - 0.25, C.black));
    }
    return g;
  };
  parts.push(...end(s.front));
  for (const g of end(s.back)) parts.push(flipped(g));
  for (const [ka, kb, h, khw, color] of s.roofKit || []) parts.push(box(ka, kb, s.roof - 0.02, s.roof + h, khw, color, khw - 0.05));
  for (const x of s.wheels || []) for (const z of [hw - 0.22, -(hw - 0.22)]) parts.push(box(x - 0.5, x + 0.5, 0, 0.95, Math.abs(z) + 0.04, C.tyre, Math.abs(z) + 0.04));
  return mergeGeometries(parts);
}

/**
 * Model: { name, cars: [{ geo, len, pivot }] } with pivot = distance of each pivot from the car's centre;
 * gap: distance between consecutive cars (articulations, couplings).
 */
function model(name, cars, gap = 0.1) {
  let off = 0;
  const out = cars.map(([len, spec, pivot = len / 2 - 1.5]) => {
    const c = { len, offset: off + len / 2, pivot, geo: carBody(len, spec) };
    off += len + gap;
    return c;
  });
  return { name, cars: out, length: off - gap };
}

// ---- trams ----------------------------------------------------------------------------------------
// Flexity Wien (Bombardier/Alstom, Type D, since 2018): 34 m, 2.40 m wide, 100 % low floor, 5 sections;
// red with a black glass band and the large dark front.
function flexity() {
  const base = { w: 2.4, floor: 0.35, sill: 0.95, head: 2.45, top: 2.95, roof: 3.2, pillarStep: 1.7,
    colors: { lower: C.red, upper: C.red, roof: C.roof, skirt: C.skirt }, doorColor: C.glass, doorW: 1.3 };
  return model('Flexity Wien (Type D)', [
    [7.9, { ...base, front: 'cab', back: 'none', cab: { len: 1.8, lean: 0.55, glassFrom: 0.85, color: C.red }, doors: [1.2], roofKit: [[-3, 1.5, 0.35, 0.8, C.roofDark]] }],
    [6.1, { ...base, front: 'none', back: 'none', doors: [0], roofKit: [[-2.2, 2.2, 0.3, 0.75, C.roofDark]] }],
    [6.0, { ...base, front: 'none', back: 'none', doors: [-1.2] }],
    [6.1, { ...base, front: 'none', back: 'none', doors: [0], roofKit: [[-2.2, 2.2, 0.3, 0.75, C.roofDark]] }],
    [7.9, { ...base, front: 'none', back: 'flat', doors: [-1.2], roofKit: [[-1.5, 3, 0.35, 0.8, C.roofDark]] }],
  ], 0.08);
}
// ULF (Siemens, Type A/A1 = 24 m, 5 sections, B/B1 = 35 m, 7 sections): red, white band above the windows,
// grey roof line; extremely low floor (18 cm).
function ulf(n) {
  const base = { w: 2.4, floor: 0.2, sill: 1.0, head: 2.35, top: 2.75, roof: 3.1, pillarStep: 1.25,
    colors: { lower: C.red, upper: C.white, roof: C.roof, skirt: C.skirt }, doorColor: C.door, doorW: 1.3, stripe: [2.35, 2.43, C.grey] };
  const cars = [];
  const L = n === 5 ? 24.2 : 35.5, len = (L - (n - 1) * 0.08) / n;
  for (let i = 0; i < n; i++)
    cars.push([len, { ...base, front: i === 0 ? 'cab' : 'none', back: i === n - 1 ? 'flat' : 'none', cab: { len: 1.5, lean: 0.35, glassFrom: 1.0, color: C.red },
      doors: i % 2 === 0 ? [0] : [], roofKit: i % 2 === 1 ? [[-1.5, 1.5, 0.3, 0.75, C.roofDark]] : [] }, len / 2 - 0.8]);
  return model(n === 5 ? 'ULF (Type A1)' : 'ULF (Type B1)', cars, 0.08);
}
// Badner Bahn Reihe 500 (Alstom Flexity 2, since 2022): 27.8 m, 2.55 m wide, bidirectional; WLB blue and white.
function wlb500() {
  const base = { w: 2.55, floor: 0.35, sill: 1.0, head: 2.4, top: 2.95, roof: 3.25, pillarStep: 1.6,
    colors: { lower: C.wlbBlue, upper: C.wlbLight, roof: C.roof, skirt: C.skirt }, doorColor: C.glass, doorW: 1.3 };
  const cab = { len: 1.9, lean: 0.6, glassFrom: 0.95, color: C.wlbBlue };
  return model('Reihe 500 (Flexity 2)', [
    [10.1, { ...base, front: 'cab', back: 'none', cab, doors: [1.5], roofKit: [[-3, 0.5, 0.4, 0.85, C.roofDark]] }],
    [7.4, { ...base, front: 'none', back: 'none', doors: [0] }],
    [10.1, { ...base, front: 'none', back: 'cab', cab, doors: [-1.5], roofKit: [[-0.5, 3, 0.4, 0.85, C.roofDark]] }],
  ], 0.08);
}

// ---- U-Bahn -------------------------------------------------------------------------------------
// X-Wagen (Siemens, in service since 2023): 6 cars, 111 m, 2.85 m wide, open gangways, bidirectional;
// light silver body, black window band and fronts, red accents.
function xWagen() {
  const base = { w: 2.85, floor: 1.0, sill: 1.6, head: 2.85, top: 3.35, roof: 3.6, skirtFrom: 0.35, pillarStep: 2.1,
    colors: { lower: C.silver, upper: C.silver, roof: C.roof, skirt: C.skirt }, doorColor: C.red, doorW: 1.4, stripe: [1.52, 1.6, C.red] };
  const cab = { len: 2.4, lean: 0.9, glassFrom: 1.3, color: C.black, capColor: C.black, stripe: [1.05, 1.2, C.red] };
  const doors = [-5.6, 0, 5.6];
  const cars = [];
  for (let i = 0; i < 6; i++)
    cars.push([18.4, { ...base, front: i === 0 ? 'cab' : 'gangway', back: i === 5 ? 'cab' : 'none', cab, doors, roofKit: [[-4, 4, 0.18, 1.0, C.roofDark]] }, 6.3]);
  return model('X-Wagen (Type X)', cars, 0.12);
}
// U6: Type T1 (Bombardier, since 2008), 27 m, three-part, bidirectional, usually four units in a row;
// white with red window frames and a dark front.
function t1() {
  const base = { w: 2.65, floor: 0.4, sill: 1.05, head: 2.4, top: 3.0, roof: 3.3, pillarStep: 1.5,
    colors: { lower: C.white, upper: C.white, roof: C.roof, skirt: C.skirt }, doorColor: C.red, doorW: 1.3, stripe: [0.95, 1.05, C.red] };
  const cab = { len: 1.8, lean: 0.55, glassFrom: 0.95, color: C.white, stripe: [0.6, 0.75, C.red] };
  const cars = [];
  for (let u = 0; u < 4; u++)
    cars.push(
      [10.6, { ...base, front: 'cab', back: 'none', cab, doors: [1.3], roofKit: [[-3, 0, 0.35, 0.8, C.roofDark]] }],
      [6.2, { ...base, front: 'none', back: 'none', doors: [0] }],
      [10.6, { ...base, front: 'none', back: 'cab', cab, doors: [-1.3], roofKit: [[0, 3, 0.35, 0.8, C.roofDark]] }]
    );
  const m = model('Type T1', cars, 0.1);
  // a little more space where two units are coupled
  let off = 0;
  m.cars.forEach((c, i) => {
    c.offset = off + c.len / 2;
    off += c.len + (i % 3 === 2 ? 0.7 : 0.1);
  });
  m.length = off;
  return m;
}

// ---- buses -----------------------------------------------------------------------------------------
// Wiener Linien red; contractors' buses run in the same livery. Pivots: front and rear axle.
const BUS = { w: 2.55, floor: 0.38, sill: 1.05, head: 2.55, top: 2.85, roof: 3.0, skirtFrom: 0.3, pillarStep: 1.7,
  colors: { lower: C.red, upper: C.red, roof: C.white, skirt: C.skirt }, doorColor: C.glass, doorW: 1.2 };
const busCab = { len: 0.6, lean: 0.12, glassFrom: 0.95, color: C.red, capColor: C.red };
function bus(name, len, roofKit, opts = {}) {
  const fa = len / 2 - 2.7, ra = -(len / 2 - 3.4);
  return model(name, [[len, { ...BUS, ...opts, front: 'cab', back: 'flat', cab: busCab, doors: [len / 2 - 1.3, -0.2, ...(len > 11 ? [-len / 2 + 2.6] : [])], wheels: [fa, ra], roofKit }, (fa - ra) / 2]]);
}
function articulated(name, lenA, lenB, roofKitA, roofKitB = []) {
  // front car pivots: front axle and the joint; rear car: joint and rear axle (the pivot math takes the
  // midpoint, so the cars carry their axles symmetric around their centre, close enough at this scale)
  return model(name, [
    [lenA, { ...BUS, front: 'cab', back: 'none', cab: busCab, doors: [lenA / 2 - 1.3, 0.3, -lenA / 2 + 1.4], wheels: [lenA / 2 - 2.7, -lenA / 2 + 1.8], roofKit: roofKitA }, lenA / 2 - 1.6],
    [lenB, { ...BUS, front: 'gangway', back: 'flat', doors: [lenB / 2 - 1.6], wheels: [-lenB / 2 + 2.6], roofKit: roofKitB }, lenB / 2 - 1.6],
  ], 0.35);
}
const AC = (x0, x1) => [x0, x1, 0.32, 0.9, C.white];
const PACK = (x0, x1) => [x0, x1, 0.4, 1.05, C.roof];

const BUILDERS = {
  flexity,
  ulfA: () => ulf(5),
  ulfB: () => ulf(7),
  wlb500,
  xWagen,
  t1,
  citaro: () => bus('Mercedes-Benz Citaro', 12.1, [AC(-1, 2)]),
  ecitaro: () => bus('Mercedes-Benz eCitaro', 12.1, [PACK(-4.5, -0.5), AC(0, 2.2), PACK(2.5, 4.8)]),
  lionsCity: () => bus("MAN Lion's City 12", 12.2, [AC(-1.5, 1.5), [-5.5, -3.5, 0.45, 0.9, C.white]]),
  hydron: () => bus('Rampini Hydron', 8.0, [[-2.5, 1.5, 0.5, 1.0, C.white]], { w: 2.2 }),
  h2city: () => bus('CaetanoBus H2.City Gold', 12.0, [[1.5, 5.3, 0.55, 1.1, C.silver], AC(-2.5, 0.5)]),
  citaroG: () => articulated('Mercedes-Benz Citaro G', 10.7, 7.4, [AC(-1, 2)]),
  capacity: () => articulated('Mercedes-Benz CapaCity L', 11.6, 9.0, [AC(-1, 2)], [AC(-1, 1)]),
};
const cache = new Map();
/** Model by key (built on first use). */
export function getModel(key) {
  if (!cache.has(key)) cache.set(key, { key, ...BUILDERS[key]() });
  return cache.get(key);
}

// ---- which vehicle runs on which line ------------------------------------------------------------
const set = (s) => new Set(s.split(' '));
const TRAM_FLEXITY = set('D O 1 6 11 18 43 46 49 60 71');
const TRAM_ULF_B = set('2 12 25 26 27 30 31 40 41');
const TRAM_ULF_A = set('5 9 10 37 38 42 44 52 62');
const BUS_ECITARO = set('9A 17A 57A 61A 61B 64A 64B 70A 71A 71B 73B');
const BUS_HYDRON = set('2A 3A');
const BUS_H2 = set('39A');
const BUS_LIONS = set('20A 20B 33A 56A 56B 58A 58B');
const BUS_CAPACITY = set('11A');
// articulated: per the vehicle lists above, plus the busiest Wiener Linien lines (approximate)
const BUS_ARTIC = set('7A 10A 13A 14A 15A 26A 27A 29A 31A 34A 35A 48A 59A 62A 63A 66A 68A 68B 69A 73A 92A 92B N6 N25 N29 N31 N46 N49 N60 N62 N66 N71');

/** Model key for a line (mode as in scripts/build-transit.mjs: 0 tram, 1 U-Bahn, 2 bus, 3 night bus, 4 Badner Bahn). */
export function lineModel(name, mode) {
  if (mode === 1) return name === 'U6' ? 't1' : 'xWagen';
  if (mode === 4) return 'wlb500';
  if (mode === 0) return TRAM_FLEXITY.has(name) ? 'flexity' : TRAM_ULF_B.has(name) ? 'ulfB' : TRAM_ULF_A.has(name) ? 'ulfA' : 'flexity';
  if (BUS_HYDRON.has(name)) return 'hydron';
  if (BUS_H2.has(name)) return 'h2city';
  if (BUS_ECITARO.has(name)) return 'ecitaro';
  if (BUS_LIONS.has(name)) return 'lionsCity';
  if (BUS_CAPACITY.has(name)) return 'capacity';
  if (BUS_ARTIC.has(name)) return 'citaroG';
  return 'citaro';
}

export const vehicleMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
