import { convertSheet, SHEET_RE } from '../../server/lod2.js';

// GET /api/lod2/:sheet -> gzipped LOD2 binary, cached forever at the CDN (source data is static).
export default async function handler(req, res) {
  const id = String(req.query.sheet || '');
  if (!SHEET_RE.test(id)) return res.status(400).send('bad sheet id');
  try {
    const body = await convertSheet(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(Buffer.from(body));
  } catch (e) {
    res.status(502).send(String(e.message || e));
  }
}
