import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { convertSheet, SHEET_RE } from './server/lod2.js';

// Dev-server twin of api/lod2/[sheet].js, with a disk cache in .cache/lod2.
function lod2Dev() {
  const dir = path.resolve('.cache/lod2');
  const pending = new Map();
  return {
    name: 'lod2-dev',
    configureServer(server) {
      fs.mkdirSync(dir, { recursive: true });
      server.middlewares.use('/api/lod2/', async (req, res) => {
        const id = (req.url || '').replace(/^\//, '').split('?')[0];
        if (!SHEET_RE.test(id)) return (res.statusCode = 400), res.end('bad sheet id');
        const file = path.join(dir, `${id}.bin.gz`);
        try {
          if (!fs.existsSync(file)) {
            if (!pending.has(id)) pending.set(id, convertSheet(id).then((b) => fs.writeFileSync(file, b)).finally(() => pending.delete(id)));
            await pending.get(id);
          }
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Encoding', 'gzip');
          res.end(fs.readFileSync(file));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e.message || e));
        }
      });
    },
  };
}

export default defineConfig({ plugins: [lod2Dev()] });
