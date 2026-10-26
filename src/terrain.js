import { worldToTile } from './geo.js';

// Terrarium-encoded elevation tiles (AWS Open Data "Terrain Tiles").
// Over Austria their source is the Austrian OGD 10 m DGM (austria/ogd-10m-at.tif).
const TZ = 14;
const URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`;
const FALLBACK_HEIGHT = 170;

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
        return r.blob();
      })
      .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((bmp) => {
        const c = new OffscreenCanvas(256, 256);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, 256, 256).data;
        const data = new Float32Array(256 * 256);
        for (let i = 0; i < data.length; i++) {
          data[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
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
