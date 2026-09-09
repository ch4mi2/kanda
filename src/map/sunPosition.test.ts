import { describe, expect, it } from 'vitest';
import { slstNowMinutes, sunDateFromSlstMinutes, sunPosition } from './sunPosition';

// Island centre, matching config/tiles DEFAULT_CENTER.
const LAT = 6.85;
const LON = 80.7;

describe('sunPosition over Sri Lanka', () => {
  it('near equinox: sunrise is low in the east, sunset low in the west', () => {
    const sunrise = sunPosition(sunDateFromSlstMinutes(6 * 60), LAT, LON);
    expect(Math.abs(sunrise.altitudeDeg)).toBeLessThan(6);
    expect(sunrise.azimuthDeg).toBeGreaterThan(75);
    expect(sunrise.azimuthDeg).toBeLessThan(105);

    const sunset = sunPosition(sunDateFromSlstMinutes(18 * 60), LAT, LON);
    expect(Math.abs(sunset.altitudeDeg)).toBeLessThan(10);
    expect(sunset.azimuthDeg).toBeGreaterThan(255);
    expect(sunset.azimuthDeg).toBeLessThan(285);
  });

  it('local noon puts the sun high', () => {
    const noon = sunPosition(sunDateFromSlstMinutes(12 * 60), LAT, LON);
    expect(noon.altitudeDeg).toBeGreaterThan(60);
  });

  it('midnight sun is well below the horizon', () => {
    const midnight = sunPosition(sunDateFromSlstMinutes(0), LAT, LON);
    expect(midnight.altitudeDeg).toBeLessThan(-20);
  });

  it('slstNowMinutes stays in range', () => {
    const m = slstNowMinutes();
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(1440);
  });
});
