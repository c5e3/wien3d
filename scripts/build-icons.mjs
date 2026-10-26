// Renders the app icons (Stephansdom + Riesenrad on Wien red) into public/icons/.
// Usage: node scripts/build-icons.mjs

import fs from 'node:fs';
import { PNG } from 'pngjs';

const RED = [0xc8, 0x02, 0x3c];
const OUT = 'public/icons';

// shapes in a 100 x 100 box, white on red
const SHAPES = [
  { rect: [16, 76, 84, 79] }, // ground
  { rect: [18, 58, 30, 76] }, // nave
  { rect: [30, 44, 44, 76] }, // tower
  { poly: [[30, 44], [44, 44], [37, 16]] }, // spire
  { ring: [64, 50, 11.5, 14] }, // Riesenrad
  { ring: [64, 50, 0, 2.5] }, // hub
  { poly: [[63, 50], [65, 50], [72.5, 76], [70, 76]] }, // legs
  { poly: [[63, 50], [65, 50], [58, 76], [55.5, 76]] },
  // spokes
  ...[0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a), r = 12, w = 0.6;
    return { poly: [[64 + c * r - s * w, 50 + s * r + c * w], [64 + c * r + s * w, 50 + s * r - c * w], [64 - c * r + s * w, 50 - s * r - c * w], [64 - c * r - s * w, 50 - s * r + c * w]] };
  }),
];

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function hit(x, y) {
  for (const s of SHAPES) {
    if (s.rect && x >= s.rect[0] && x <= s.rect[2] && y >= s.rect[1] && y <= s.rect[3]) return true;
    if (s.poly && inPoly(s.poly, x, y)) return true;
    if (s.ring) {
      const d = Math.hypot(x - s.ring[0], y - s.ring[1]);
      if (d >= s.ring[2] && d <= s.ring[3]) return true;
    }
  }
  return false;
}

// scale < 1 shrinks the drawing into the maskable safe zone
function png(size, file, scale = 1) {
  const img = new PNG({ width: size, height: size });
  const SS = 4;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = 50 + (((px + (sx + 0.5) / SS) / size) * 100 - 50) / scale;
          const y = 50 + (((py + (sy + 0.5) / SS) / size) * 100 - 50) / scale;
          if (hit(x, y)) cov++;
        }
      cov /= SS * SS;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(RED[c] + (255 - RED[c]) * cov);
      img.data[i + 3] = 255;
    }
  fs.writeFileSync(`${OUT}/${file}`, PNG.sync.write(img));
}

function svg() {
  const el = SHAPES.map((s) => {
    if (s.rect) return `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2] - s.rect[0]}" height="${s.rect[3] - s.rect[1]}"/>`;
    if (s.poly) return `<polygon points="${s.poly.map((p) => p.join(',')).join(' ')}"/>`;
    const [cx, cy, ri, ro] = s.ring;
    return ri ? `<circle cx="${cx}" cy="${cy}" r="${(ri + ro) / 2}" fill="none" stroke="#fff" stroke-width="${ro - ri}"/>` : `<circle cx="${cx}" cy="${cy}" r="${ro}"/>`;
  });
  const hex = '#' + RED.map((c) => c.toString(16).padStart(2, '0')).join('');
  fs.writeFileSync(`${OUT}/icon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="${hex}"/><g fill="#fff">${el.join('')}</g></svg>\n`);
}

fs.mkdirSync(OUT, { recursive: true });
png(192, 'icon-192.png');
png(512, 'icon-512.png');
png(512, 'icon-maskable-512.png', 0.8);
png(180, 'apple-touch-icon.png');
svg();
console.log('icons written to', OUT);
