import * as THREE from 'three';
import { lonLatToWorld, worldToLonLat } from './geo.js';
import { Terrain } from './terrain.js';
import { Collision } from './collision.js';
import { ChunkManager } from './chunks.js';
import { Player } from './player.js';

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

// ---- landmarks (keys 1-9) -------------------------------------------------------------------
const PLACES = [
  ['Stephansdom', 48.2079, 16.3716, 25, -2.4],
  ['Prater / Riesenrad', 48.2160, 16.3940, 40, -2.3],
  ['Schönbrunn', 48.1830, 16.3122, 50, 0],
  ['Belvedere', 48.1885, 16.3809, 40, 0],
  ['Rathaus', 48.2108, 16.3540, 30, -1.57],
  ['Karlskirche', 48.1972, 16.3718, 25, 0],
  ['Donau City', 48.2290, 16.4100, 80, -0.6],
  ['Hofburg / Heldenplatz', 48.2058, 16.3620, 30, -1.0],
  ['Kahlenberg', 48.2765, 16.3346, 40, 2.5],
];
function goTo(i) {
  const [, lat, lon, h, yaw] = PLACES[i];
  const [x, z] = lonLatToWorld(lon, lat);
  player.teleport(x, z, h);
  player.yaw = yaw;
  player.pitch = -0.15;
}
document.addEventListener('keydown', (e) => {
  if (!player.locked) return;
  const d = /^Digit([1-9])$/.exec(e.code);
  if (d && PLACES[+d[1] - 1]) goTo(+d[1] - 1);
});
document.getElementById('places').innerHTML = PLACES.map((p, i) => `<li><b>${i + 1}</b> ${p[0]}</li>`).join('');

// ---- start position: #lat,lon,heightAboveGround,yaw,pitch or Stephansdom ----------------------
const hash = location.hash.slice(1).split(',').map(Number);
if (hash.length >= 2 && hash.every(Number.isFinite)) {
  const [x, z] = lonLatToWorld(hash[1], hash[0]);
  player.teleport(x, z, hash[2] ?? 40);
  player.yaw = hash[3] ?? 0;
  player.pitch = hash[4] ?? -0.2;
} else goTo(0);

// ---- UI -----------------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
overlay.addEventListener('click', () => player.lock());
if (new URLSearchParams(location.search).has('shot')) overlay.classList.add('hidden');
player.onToggle = (locked) => overlay.classList.toggle('hidden', locked);
window.addEventListener('beforeunload', (e) => {
  // guard against Ctrl+W while sprinting with Ctrl
  if (player.locked) e.preventDefault();
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
    `Building parts: ${chunks.stats.buildings} · Loading: ${chunks.pending}`;
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
  updateHud(now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__wien = { player, chunks, terrain, camera };
