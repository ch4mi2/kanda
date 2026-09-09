// Where the sun is in the sky for a given instant and place.
//
// Low-precision NOAA / US Naval Observatory almanac algorithm — accurate to
// ~0.01° for any date within a couple of centuries of J2000, which is far
// past what a hillshade needs. No dependency; ~40 lines of trigonometry.
//
// Used to drive the hillshade light (direction = azimuth, altitude = real sun
// elevation) so the relief shading tells a time-of-day story and a scrub
// slider can sweep shadows across the ranges. See src/map/buildStyle.ts
// (hillshadeLightForSun) and src/components/TimeOfDaySlider.tsx.

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Compass bearing of the sun, degrees clockwise from north (0–360). */
  azimuthDeg: number;
  /** Sun elevation above the horizon, degrees (negative = below horizon). */
  altitudeDeg: number;
}

/**
 * Sun position for `date` (a real instant) as seen from `latDeg`/`lonDeg`.
 * Longitude is positive east.
 */
export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  // Days since the J2000.0 epoch (2000-01-01 12:00 UTC).
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;

  // Sun's mean longitude and mean anomaly (degrees).
  const meanLon = mod360(280.46 + 0.9856474 * n);
  const meanAnom = mod360(357.528 + 0.9856003 * n) * RAD;

  // Ecliptic longitude (equation of centre applied) and obliquity.
  const eclLon =
    (meanLon + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  // Right ascension and declination.
  const rightAsc = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclLon),
    Math.cos(eclLon),
  );
  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));

  // Greenwich mean sidereal time (hours) -> local hour angle (radians).
  const gmstHours = mod(18.697374558 + 24.06570982441908 * n, 24);
  const localSiderealDeg = mod360(gmstHours * 15 + lonDeg);
  const hourAngle = localSiderealDeg * RAD - rightAsc;

  const lat = latDeg * RAD;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(decl) +
      Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  );

  return {
    azimuthDeg: mod360(azimuth / RAD),
    altitudeDeg: altitude / RAD,
  };
}

function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}
function mod360(a: number): number {
  return mod(a, 360);
}

// Sri Lanka Standard Time is a fixed UTC+5:30 year-round (no DST), so the sun
// scrub slider works in SLST minutes-past-midnight and we convert to a real
// UTC instant here — independent of whatever timezone the user's device is in.
export const SLST_OFFSET_MIN = 330;

/** A real `Date` for `minutes` past midnight SLST, on today's SLST date. */
export function sunDateFromSlstMinutes(minutes: number): Date {
  const nowSlst = new Date(Date.now() + SLST_OFFSET_MIN * 60000);
  return new Date(
    Date.UTC(
      nowSlst.getUTCFullYear(),
      nowSlst.getUTCMonth(),
      nowSlst.getUTCDate(),
      0,
      minutes - SLST_OFFSET_MIN,
    ),
  );
}

/** Minutes past midnight SLST right now (0–1439). */
export function slstNowMinutes(): number {
  const nowSlst = new Date(Date.now() + SLST_OFFSET_MIN * 60000);
  return nowSlst.getUTCHours() * 60 + nowSlst.getUTCMinutes();
}
