// Production server for the roof model (see deploy/): a tiny HTTP server behind nginx
// that answers GET /api/lod2/:sheet, with a disk cache like the Vite dev server.
//   PORT (default 3017), HOST (default 127.0.0.1), LOD2_CACHE (default .cache/lod2)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { convertSheet, SHEET_RE } from './lod2.js';

const PORT = Number(process.env.PORT || 3017);
const HOST = process.env.HOST || '127.0.0.1';
const dir = path.resolve(process.env.LOD2_CACHE || '.cache/lod2');
fs.mkdirSync(dir, { recursive: true });

// Converting a sheet unzips and parses a few MB of GML, so keep only a couple in flight at once.
const MAX_CONVERSIONS = 2;
let running = 0;
const queue = [];
const limited = async (fn) => {
  if (running >= MAX_CONVERSIONS) await new Promise((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
};

const pending = new Map();
function sheet(id) {
  const file = path.join(dir, `${id}.bin.gz`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (!pending.has(id)) {
    const job = limited(() => convertSheet(id)).then((b) => {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, b);
      fs.renameSync(tmp, file);
      return file;
    });
    pending.set(id, job.finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

http
  .createServer(async (req, res) => {
    const m = /^\/api\/lod2\/([^/?]*)/.exec(req.url || '');
    if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return (res.statusCode = 404), res.end('not found');
    if (!SHEET_RE.test(m[1])) return (res.statusCode = 400), res.end('bad sheet id');
    try {
      const body = fs.readFileSync(await sheet(m[1]));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      res.statusCode = 502;
      res.end(String(e.message || e));
    }
  })
  .listen(PORT, HOST, () => console.log(`lod2 server on http://${HOST}:${PORT}, cache in ${dir}`));
