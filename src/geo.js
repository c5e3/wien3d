// Coordinate helpers.
// World space: metres, x = east, z = south (three.js -z is north), y = metres above Adriatic sea level.
// We use Web Mercator scaled by cos(lat0), so mercator tiles map to axis-aligned squares in world space.

const R = 6378137;
const D2R = Math.PI / 180;
export const MERC_SIZE = 2 * Math.PI * R;

export const ORIGIN = { lat: 48.2085, lon: 16.3731 }; // Stephansplatz
export const K = Math.cos(ORIGIN.lat * D2R);

const mx0 = R * ORIGIN.lon * D2R;
const my0 = R * Math.log(Math.tan(Math.PI / 4 + (ORIGIN.lat * D2R) / 2));

// "Wiener Null" – Vienna's local height datum, metres above Adriatic (used by the building model).
export const WIENER_NULL = 156.68;

export function lonLatToWorld(lon, lat) {
  const mx = R * lon * D2R;
  const my = R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
  return [(mx - mx0) * K, -(my - my0) * K];
}

export function worldToLonLat(x, z) {
  const mx = x / K + mx0;
  const my = -z / K + my0;
  return [mx / R / D2R, (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / D2R];
}

/** Fractional tile coordinates of a world position at zoom z. */
export function worldToTile(z, x, wz) {
  const s = MERC_SIZE / 2 ** z;
  const mx = x / K + mx0;
  const my = -wz / K + my0;
  return [(mx + MERC_SIZE / 2) / s, (MERC_SIZE / 2 - my) / s];
}

/** World-space bounds of a slippy-map tile. */
export function tileBounds(z, x, y) {
  const s = MERC_SIZE / 2 ** z;
  const mxMin = -MERC_SIZE / 2 + x * s;
  const myMax = MERC_SIZE / 2 - y * s;
  const xMin = (mxMin - mx0) * K;
  const zMin = -(myMax - my0) * K;
  const size = s * K;
  return { xMin, zMin, xMax: xMin + size, zMax: zMin + size, size };
}

/** Lon/lat bounding box of a tile: [west, south, east, north]. */
export function tileLonLatBBox(z, x, y) {
  const n = 2 ** z;
  const lon = (tx) => (tx / n) * 360 - 180;
  const lat = (ty) => Math.atan(Math.sinh(Math.PI - (2 * Math.PI * ty) / n)) / D2R;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}
