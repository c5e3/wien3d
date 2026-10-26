import * as THREE from 'three';
import { lonLatToWorld, worldToLonLat } from './geo.js';
import { Terrain } from './terrain.js';
import { Collision } from './collision.js';
import { ChunkManager } from './chunks.js';
import { Player } from './player.js';
import { PoiManager } from './poi.js';
import { InfoUI } from './info.js';

const SKY = 0xb8d3ea;

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 900, 2600);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2.2));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
sun.position.set(-0.5, 1, 0.35);
scene.add(sun);

const terrain = new Terrain();
const collision = new Collision();
const chunks = new ChunkManager({ scene, terrain, collision, renderer });
const player = new Player(camera, renderer.domElement, terrain, collision);
const pois = new PoiManager({ scene, terrain, player, chunks });
const info = new InfoUI({ camera, chunks, pois, terrain });

// ---- landmarks (keys 1-9): name, lat, lon, height above ground, yaw, pitch -------------------
const PLACES = [
  ['Stephansdom', 48.20813, 16.37129, 117.4, -7.59, -0.42],
  ['Prater', 48.21596, 16.39418, 161.6, -7.68, -0.66],
  ['Schönbrunn', 48.18862, 16.31425, 137.5, 2.8, -0.28],
  ['Belvedere', 48.19894, 16.37979, 250.6, -3.23, -0.56],
  ['Rathaus', 48.21025, 16.3617, 108.7, -4.91, -0.31],
  ['Karlskirche / Resselpark', 48.20076, 16.37276, 147.7, -3.78, -0.6],
  ['Donaucity', 48.22869, 16.40859, 185.0, -0.67, -0.22],
  ['ZwiDeMu / Heldenplatz', 48.20359, 16.35921, 157.3, -0.85, -0.58],
  ['Spittelau', 48.23684, 16.3598, 150.8, 2.64, -0.39],
];
function view(lat, lon, h = 40, yaw = 0, pitch = -0.2) {
  const [x, z] = lonLatToWorld(lon, lat);
  player.teleport(x, z, h);
  player.yaw = yaw;
  player.pitch = pitch;
}
const goTo = (i) => view(...PLACES[i].slice(1));
document.addEventListener('keydown', (e) => {
  if (!player.active) return;
  const d = /^Digit([1-9])$/.exec(e.code);
  if (d && PLACES[+d[1] - 1]) goTo(+d[1] - 1);
});
document.getElementById('places').innerHTML = PLACES.map((p, i) => `<li><b>${i + 1}</b> ${p[0]}</li>`).join('');

// ---- start position: #lat,lon,heightAboveGround,yaw,pitch or landmark 1 (crosshair on the Stephansdom) ----
const hash = location.hash.slice(1).split(',').map(Number);
if (hash.length >= 2 && hash.every(Number.isFinite)) view(...hash);
else goTo(0);

// ---- UI -----------------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) overlay.classList.add('hidden');
// Mouse mode (M): controls off, normal cursor (click links, select text); M or a click into the scene resumes.
let mouseMode = false;
const crosshair = document.getElementById('crosshair');
const mouseHint = document.getElementById('mouse-mode');
function setMouseMode(on) {
  mouseMode = on;
  mouseHint.classList.toggle('hidden', !on);
  crosshair.classList.toggle('hidden', on);
}

// Esc closes the topmost thing (POI list, info box, menu) and returns to the last mode, play or mouse mode;
// only an Esc with nothing open shows the menu. While the pointer is locked the browser takes Esc itself to
// unlock, and wants a click before locking again, so play mode carries on as "soft play" until that click.
let lastMode = 'play', releasing = false, unlockT = 0;
const menuOpen = () => !overlay.classList.contains('hidden');
function enterPlay() {
  lastMode = 'play';
  setMouseMode(false);
  overlay.classList.add('hidden');
  player.setSoft(true); // replaced by the real lock if the browser grants it without a click
  player.lock();
}
function enterMouseMode() {
  leavePlay();
  lastMode = 'mouse';
  overlay.classList.add('hidden');
  setMouseMode(true);
}
function leavePlay() {
  if (player.locked) {
    releasing = true;
    document.exitPointerLock();
  }
  player.setSoft(false);
  player.keys.clear();
}
function showMenu() {
  leavePlay();
  setMouseMode(false);
  overlay.classList.toggle('hidden', shot);
}
const resume = () => (lastMode === 'mouse' ? enterMouseMode() : enterPlay());
// Esc in a mode: close the info box if open, else the menu
const escape = () => (info.open ? info.close() : showMenu());

overlay.addEventListener('click', enterPlay);
player.onToggle = (locked) => {
  if (locked) {
    lastMode = 'play';
    setMouseMode(false);
    overlay.classList.add('hidden');
    return;
  }
  unlockT = performance.now();
  if (releasing) releasing = false; // P / M / menu: their own UI takes over
  else if (!shot) {
    // the user's Esc (or focus loss) while playing
    if (info.open) {
      info.close();
      enterPlay();
    } else showMenu();
  }
};

// P: POI browser (from play mode), click: info about what the crosshair points at, X: close info
function closePois() {
  pois.hide();
  enterPlay();
}
document.getElementById('poi-close').addEventListener('click', closePois);
document.addEventListener('keydown', (e) => {
  const esc = e.code === 'Escape';
  if (esc) {
    e.preventDefault();
    // a locked Esc is handled on the unlock; ignore the same Esc arriving afterwards
    if (player.locked || performance.now() - unlockT < 250) return;
  }
  if (pois.open) {
    if (esc || (e.code === 'KeyP' && document.activeElement !== pois.search)) {
      e.preventDefault();
      closePois();
    }
  } else if (menuOpen()) {
    if (esc) resume();
  } else if (player.active) {
    if (esc) escape();
    else if (e.code === 'KeyP') {
      e.preventDefault(); // or the "p" lands in the search field that show() focuses
      leavePlay();
      pois.show();
    } else if (e.code === 'KeyM') enterMouseMode();
    else if (e.code === 'KeyX') info.close();
    else if (e.code === 'KeyC') hud.classList.toggle('hidden');
  } else if (mouseMode) {
    if (esc) escape();
    else if (e.code === 'KeyM') enterPlay();
    else if (e.code === 'KeyX') info.close();
    else if (e.code === 'KeyC') hud.classList.toggle('hidden');
  }
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    if (player.active || mouseMode) info.close();
  } else if (e.button === 0) {
    if (player.active) {
      if (!player.locked) player.lock(); // soft play: this click lets the browser lock again
      info.click();
    } else if (mouseMode && e.target === renderer.domElement) enterPlay(); // not on a panel or link
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
// screenshot/debug helpers: ?poi=MUSEUMOGD,SEHENSWUERDIGOGD  &info (click after load)
if (params.get('poi')) pois.ready.then(() => params.get('poi').split(',').forEach((id) => pois.toggle(id, true)));
if (params.has('info')) setTimeout(() => info.click(), 20000);
if (params.has('panel')) setTimeout(() => pois.show(), 5000);
window.addEventListener('beforeunload', (e) => {
  // guard against Ctrl+W while sprinting with Ctrl
  if (player.active) e.preventDefault();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let hudT = 0, hashT = 0;
function updateHud(now) {
  if (now - hudT < 200) return;
  hudT = now;
  const p = player.pos;
  const [lon, lat] = worldToLonLat(p.x, p.z);
  const g = terrain.heightAt(p.x, p.z);
  const mode = player.noclip ? 'Noclip' : player.flying ? 'Flying' : 'Walking';
  hud.innerHTML =
    `${lat.toFixed(5)}, ${lon.toFixed(5)}<br>` +
    `Alt ${Number.isNaN(p.y) ? '…' : p.y.toFixed(1)} m ü.A. · ${g !== null && !Number.isNaN(p.y) ? (p.y - g).toFixed(1) + ' m above ground' : ''}<br>` +
    `${mode}${player.sprinting ? ' · Sprint' : ''} · Speed ×${player.speedMult}<br>` +
    `Buildings: ${chunks.stats.buildings} · Loading: ${chunks.pending}`;
  if (now - hashT > 2000 && !Number.isNaN(p.y)) {
    hashT = now;
    const ah = g !== null ? (p.y - g).toFixed(1) : 40;
    history.replaceState(null, '', `#${lat.toFixed(5)},${lon.toFixed(5)},${ah},${player.yaw.toFixed(2)},${player.pitch.toFixed(2)}`);
  }
}

// ---- loop ---------------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  player.update(dt);
  chunks.update(player.pos);
  pois.update(dt);
  info.update(dt, player.active || shot);
  updateHud(now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__wien = { player, chunks, terrain, camera, pois, info };
