import { rnd } from './util';

/** Průměrná denní teplota (°C): střední Evropa, nížina/pahorkatina.
 *  Roční chod -1,5 °C (leden) až 19,5 °C (červenec) + odchylka daného roku ±1,2 °C,
 *  takže rašení vychází každý rok o pár dní jinak. */
export function temperature(seed: number, year: number, doy: number): number {
  const anomaly = (rnd(seed, 9001, year) - 0.5) * 2.4;
  const wave = (rnd(seed, 9002, year) - 0.5) * 20; // posun nástupu jara ve dnech
  return 9 + anomaly * 0.5 + 10.5 * Math.cos((2 * Math.PI * (doy - 200 + wave * 0.3)) / 365);
}

export const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function dateOf(doy: number): { day: number; month: number } {
  let m = 0, d = doy;
  while (d >= MDAYS[m]) { d -= MDAYS[m]; m++; }
  return { day: d + 1, month: m };
}
