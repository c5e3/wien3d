import { unzlibSync } from 'fflate';
import { worldToTile } from './geo.js';

// Terrarium-encoded elevation tiles (AWS Open Data "Terrain Tiles").
// Over Austria their source is the Austrian OGD 10 m DGM (austria/ogd-10m-at.tif).
const TZ = 14;
const URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`;
const FALLBACK_HEIGHT = 170;

/**
 * Minimal PNG decoder for the 8-bit, non-interlaced RGB(A) terrarium tiles -> RGB bytes. Decoding through a
 * canvas is not an option: Safari's fingerprinting protection adds noise to getImageData, and since the red
 * channel carries height * 256 that turns the terrain into spikes.
 */
function decodePng(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idat = [];
  let w = 0, h = 0, ch = 0;
  for (let o = 8; o + 8 <= png.length; ) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8);
      h = dv.getUint32(o + 12);
      const depth = png[o + 16], color = png[o + 17], interlace = png[o + 20];
      ch = color === 2 ? 3 : color === 6 ? 4 : 0;
      if (depth !== 8 || !ch || interlace) throw new Error(`unsupported png (depth ${depth}, color ${color}, interlace ${interlace})`);
    } else if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (w !== 256 || h !== 256) throw new Error(`unexpected png size ${w}x${h}`);
  let n = 0;
  for (const d of idat) n += d.length;
  const z = new Uint8Array(n);
  n = 0;
  for (const d of idat) z.set(d, n), (n += d.length);
  const raw = unzlibSync(z);
  // undo the per-scanline filters
  const stride = w * ch, img = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? img[dst + i - ch] : 0, b = y ? img[dst + i - stride] : 0, c = i >= ch && y ? img[dst + i - ch - stride] : 0;
      let p;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      img[dst + i] = raw[src + i] + p;
    }
  }
  if (ch === 3) return img;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < img.length; i += 4, j += 3) (rgb[j] = img[i]), (rgb[j + 1] = img[i + 1]), (rgb[j + 2] = img[i + 2]);
  return rgb;
}

export class Terrain {
  constructor() {
    this.tiles = new Map(); // key -> { data: Float32Array | null, promise }
  }

  _load(tx, ty) {
    const key = `${tx},${ty}`;
    let entry = this.tiles.get(key);
    if (entry) return entry.promise;
    entry = { data: null, promise: null };
    entry.promise = fetch(URL(tx, ty))
      .then((r) => {
        if (!r.ok) throw new Error(`terrain ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const px = decodePng(new Uint8Array(buf));
        const data = new Float32Array(256 * 256);
        for (let i = 0; i < data.length; i++) {
          data[i] = px[i * 3] * 256 + px[i * 3 + 1] + px[i * 3 + 2] / 256 - 32768;
        }
        entry.data = data;
      })
      .catch((e) => {
        console.warn('terrain tile failed', key, e);
        entry.data = new Float32Array(256 * 256).fill(FALLBACK_HEIGHT);
      });
    this.tiles.set(key, entry);
    return entry.promise;
  }

  /** Make sure every elevation tile touching the given world bounds is loaded. */
  ensure(b, pad = 30) {
    const [x0, y0] = worldToTile(TZ, b.xMin - pad, b.zMin - pad);
    const [x1, y1] = worldToTile(TZ, b.xMax + pad, b.zMax + pad);
    const jobs = [];
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++)
      for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) jobs.push(this._load(tx, ty));
    return Promise.all(jobs);
  }

  _px(gx, gy) {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const e = this.tiles.get(`${tx},${ty}`);
    if (!e || !e.data) return null;
    return e.data[(gy - ty * 256) * 256 + (gx - tx * 256)];
  }

  /** Bilinear elevation (m above Adriatic) or null when not loaded yet. */
  heightAt(x, z) {
    const [tx, ty] = worldToTile(TZ, x, z);
    const gx = tx * 256 - 0.5, gy = ty * 256 - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const a = this._px(ix, iy), b = this._px(ix + 1, iy);
    const c = this._px(ix, iy + 1), d = this._px(ix + 1, iy + 1);
    if (a === null || b === null || c === null || d === null) return null;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
}
