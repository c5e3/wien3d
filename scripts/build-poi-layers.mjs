// Scans the Stadt Wien WFS for every point layer and writes public/data/poi-layers.json
// ({ id, title, count, label }), used by the in-game POI browser (P key).
// Usage: node scripts/build-poi-layers.mjs

import fs from 'node:fs';

const WFS = 'https://data.wien.gv.at/daten/geo?service=WFS&version=1.1.0';
const LABEL_FIELDS = ['NAME', 'BEZEICHNUNG', 'SEITENNAME', 'OBJEKTTITEL', 'ANL_NAME', 'BASIS_NAME', 'HTXT', 'STAT_NAME', 'FEATURENAME', 'BETRIEB', 'LOCATION', 'FILIALE', 'PARK', 'STATION', 'MARKT_TXT', 'STANDORT', 'TITEL', 'EU_PROJEKTTITEL', 'BEZEICHNUNG_DE', 'KREUZUNG', 'ADRESSE', 'STRNAM', 'STRASSE'];
// raw survey data that is not useful as a POI
const SKIP = new Set(['KAPPAZUNDERIMAGEPOGD', 'KAPPAZUNDERPANOPOGD', 'LAMPENTAUSCHOGD', 'ADRESSENOGD', 'ZUGANGSADROGD', 'BAUMKATOGD']);

const caps = await (await fetch(`${WFS}&request=GetCapabilities`)).text();
const types = [...caps.matchAll(/<FeatureType[^>]*>[\s\S]*?<Name>ogdwien:([^<]*)<\/Name>[\s\S]*?<Title>([^<]*)<\/Title>/g)].map((m) => ({ id: m[1], title: m[2] }));
console.log(types.length, 'layers');

const out = [];
let i = 0;
async function worker() {
  while (i < types.length) {
    const t = types[i++];
    if (SKIP.has(t.id)) continue;
    try {
      const j = await (await fetch(`${WFS}&request=GetFeature&outputFormat=json&srsName=EPSG:4326&maxFeatures=1&typeName=ogdwien:${t.id}`)).json();
      const f = j.features?.[0];
      if (!f || !/Point/.test(f.geometry?.type || '')) continue;
      const label = LABEL_FIELDS.find((k) => k in f.properties) || null;
      out.push({ id: t.id, title: t.title.trim(), count: j.totalFeatures ?? j.numberMatched ?? 0, label });
    } catch (e) {
      console.warn(t.id, e.message);
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
out.sort((a, b) => a.title.localeCompare(b.title, 'de'));
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/poi-layers.json', JSON.stringify(out));
console.log(out.length, 'point layers written');
