import { monitor, parseStops } from '../../server/wl-monitor.js';

// GET /api/wl/monitor?stops=147,4111 -> slimmed Wiener Linien departures, cached briefly at the CDN.
export default async function handler(req, res) {
  const ids = parseStops(req.query.stops);
  if (!ids) return res.status(400).send('bad stops');
  try {
    const body = await monitor(ids);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=20');
    res.status(200).send(body);
  } catch (e) {
    res.status(502).send(String(e.message || e));
  }
}
