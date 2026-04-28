// src/utils/geo.js

/**
 * Haversine distance between two coordinates (metres).
 */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * SQL fragment that computes haversine distance in metres.
 * The query must supply :lat and :lng as parameters (or use positional $n).
 *
 * @param {string} latCol   — column name for latitude
 * @param {string} lngCol   — column name for longitude
 * @param {number} latVal   — reference latitude
 * @param {number} lngVal   — reference longitude
 * @param {number[]} params — existing parameter array (will push to it)
 * @returns {string} SQL expression string
 */
function haversineSQL(latCol, lngCol, latVal, lngVal, params) {
  const i = params.length + 1;
  params.push(latVal, lngVal);
  return `(
    6371000 * 2 * ASIN(SQRT(
      POWER(SIN((RADIANS(${latCol}) - RADIANS($${i})) / 2), 2) +
      COS(RADIANS($${i})) * COS(RADIANS(${latCol})) *
      POWER(SIN((RADIANS(${lngCol}) - RADIANS($${i + 1})) / 2), 2)
    ))
  )`;
}

module.exports = { haversineMetres, haversineSQL };
