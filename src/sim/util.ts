import type { Shoot, State, Vec3 } from './types';
import { P, potById } from './params';

export const YEAR = 365;
export const yearOf = (day: number) => Math.floor(day / YEAR);
export const doyOf = (day: number) => day % YEAR;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministický hash -> [0,1). Náhoda je vázaná na id výhonu, takže zásah na jedné větvi
 *  nezmění "náhodu" jinde ve stromu a přehrání časové osy dá vždy stejný výsledek. */
export function rnd(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// --- vektory ---
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const UP: Vec3 = [0, 1, 0];

/** Otočení vektoru kolem osy (Rodrigues). */
export function rotate(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle), d = dot(k, v) * (1 - c);
  const x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}

/** Ortonormální báze kolmá na osu p: u = vodorovně do strany, w = "nahoru" od osy. */
export function basis(p: Vec3): [Vec3, Vec3] {
  let u = cross(p, UP);
  if (Math.hypot(u[0], u[1], u[2]) < 0.15) u = cross(p, [1, 0, 0]);
  u = norm(u);
  const w = norm(cross(u, p));
  return [u, w];
}

/** Směr odkloněný od osy p o úhel theta s azimutem phi (0 = do strany, 90° = nahoru). */
export function tilt(p: Vec3, theta: number, phi: number): Vec3 {
  const [u, w] = basis(p);
  const s = Math.sin(theta), c = Math.cos(theta);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  return norm([
    p[0] * c + (u[0] * cp + w[0] * sp) * s,
    p[1] * c + (u[1] * cp + w[1] * sp) * s,
    p[2] * c + (u[2] * cp + w[2] * sp) * s,
  ]);
}

/** Bod na výhonu v podílu t jeho délky, relativně k patě (rovný úsek nebo oblouk od drátu). */
export function shootPoint(sh: Shoot, t: number): Vec3 {
  const L = sh.len, a = sh.arc;
  if (!a || Math.abs(a.angle) < 1e-4) return [sh.dir[0] * L * t, sh.dir[1] * L * t, sh.dir[2] * L * t];
  const z = Math.max(a.z, 1e-3), tt = Math.min(t, z);
  const th = (a.angle * tt) / z, R = (z * L) / a.angle;
  const n = cross(a.axis, sh.dir);
  const s = R * Math.sin(th), c = R * (1 - Math.cos(th));
  const p: Vec3 = [sh.dir[0] * s + n[0] * c, sh.dir[1] * s + n[1] * c, sh.dir[2] * s + n[2] * c];
  if (t > z) {
    const e = rotate(sh.dir, a.axis, a.angle), k = (t - z) * L;
    p[0] += e[0] * k; p[1] += e[1] * k; p[2] += e[2] * k;
  }
  return p;
}

export const radiusOf = (sh: Shoot) => Math.sqrt(sh.area / Math.PI);

export function indexMap(s: State): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < s.shoots.length; i++) m.set(s.shoots[i].id, i);
  return m;
}

/** Podíl dorůstu jehlic 0..1 (jehlice rostou déle než výhon). */
export function needleGrowth(s: State, sh: Shoot): number {
  if (sh.bornYear < yearOf(s.day)) return 1;
  if (sh.kind === 'hypocotyl') return smooth((s.day - sh.bornDay - 6) / 16);
  if (sh.kind === 'epicotyl') return 0.25 + 0.75 * smooth((s.gdd - sh.gdd0) / P.epicotylGddSpan);
  return smooth((s.gdd - P.needleStartGdd - sh.delay) / P.needleSpanGdd);
}

/** Vlastní olistění výhonu v jednotkách "1 cm výhonu s 5 svazečky 5cm jehlic". */
export function ownFoliage(s: State, sh: Shoot): number {
  if (sh.dead || sh.needleCount === 0 || sh.needleLive <= 0) return 0;
  const age = clamp(yearOf(s.day) - sh.bornYear, 0, P.ageEff.length - 1);
  const juvenile = sh.kind === 'shoot' ? 1 : P.juvenileEfficiency;
  const g = Math.max(0.15, needleGrowth(s, sh));
  return (sh.needleCount * sh.needleLen * g * sh.needleLive * P.ageEff[age] * juvenile) / 25;
}

/** Světové souřadnice pat a vrcholů všech výhonů (rodič je v poli vždy před potomkem). */
export interface Frames {
  base: Float32Array;
  tip: Float32Array;
  index: Map<number, number>;
}
export function computeFrames(s: State): Frames {
  const n = s.shoots.length;
  const base = new Float32Array(n * 3);
  const tip = new Float32Array(n * 3);
  const index = indexMap(s);
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    const pi = sh.parent < 0 ? -1 : index.get(sh.parent)!;
    if (pi >= 0) {
      const par = s.shoots[pi];
      if (par.arc) { const p = shootPoint(par, sh.attachT); for (let k = 0; k < 3; k++) base[i * 3 + k] = base[pi * 3 + k] + p[k]; }
      else for (let k = 0; k < 3; k++) base[i * 3 + k] = base[pi * 3 + k] + (tip[pi * 3 + k] - base[pi * 3 + k]) * sh.attachT;
    }
    if (sh.arc) { const p = shootPoint(sh, 1); for (let k = 0; k < 3; k++) tip[i * 3 + k] = base[i * 3 + k] + p[k]; }
    else for (let k = 0; k < 3; k++) tip[i * 3 + k] = base[i * 3 + k] + sh.dir[k] * sh.len;
  }
  return { base, tip, index };
}

/** Kolik kořenů pojme nádoba z katalogu (podle objemu v litrech). */
export const potCapFor = (potId: string) => Math.max(1, potById(potId).liters * P.rootPerLiter);

/** Zaplnění nádoby kořeny (1 = plná). */
export const rootFill = (s: State) => (s.pot === 'ground' ? 0 : s.roots / Math.max(1, s.potCap));

/** Násobitel růstu podle prokořenění: přerostlé kořeny strom dusí. */
export function rootBoundFactor(s: State): number {
  const f = rootFill(s);
  if (f <= P.rootBoundStart) return 1;
  return Math.max(P.rootBoundMin, 1 - ((1 - P.rootBoundMin) * (f - P.rootBoundStart)) / (P.rootBoundFull - P.rootBoundStart));
}

/** Bezpečný úhel ohybu výhonu drátem (rad): tenké dřevo se ohne hodně, silné málo. */
export function bendLimit(s: State, sh: Shoot, z = 0): number {
  const r = radiusOf(sh);
  let deg = clamp(P.bendK / (r + 0.25), P.bendMin, P.bendMax);
  // plynulý oblouk namáhá dřevo méně než zlom: mez určuje poloměr ohybu vůči síle větve
  if (z > 0) deg = clamp(Math.max(deg, ((z * sh.len * P.bendStrain) / Math.max(r, 0.03)) * (180 / Math.PI)), P.bendMin, P.bendArcMax);
  if (s.gdd >= P.flushGdd && s.gdd < P.budSetGdd) deg *= P.bendSpringFactor;
  return (deg * Math.PI) / 180;
}

/** Pravděpodobnost prasknutí při ohybu o daný úhel. */
export const breakRisk = (s: State, sh: Shoot, angle: number, z = 0) => {
  const safe = bendLimit(s, sh, z);
  return clamp((angle - safe) / (0.5 * safe), 0, 1);
};

/** Sezónní násobek stresu z přesazení: nejšetrnější je předjaří při nalévání pupenů. */
export function repotSeason(s: State): { k: number; name: string } {
  const doy = doyOf(s.day);
  if (s.stage === 'seed') return { k: 0, name: 'semínko' };
  if (s.gdd >= P.flushGdd && s.gdd < P.budSetGdd) return { k: 2.5, name: 'strom raší a roste – nejhorší doba' };
  if (s.gdd >= P.budSetGdd && doy < 235) return { k: 2.0, name: 'vrchol léta – nevhodná doba' };
  if (doy >= 235 && doy < 275) return { k: 1.3, name: 'pozdní léto – náhradní termín' };
  if (doy >= 275 || doy < 45) return { k: 1.6, name: 'podzim a zima – kořeny neregenerují' };
  return { k: 1.0, name: 'předjaří, pupeny nalévají – nejlepší doba' };
}

export function repotStress(s: State, prune: number): number {
  return (P.repotBaseStress + P.repotPruneStress * prune) * repotSeason(s).k;
}

export interface Stats {
  height: number;
  baseDiameter: number;
  shoots: number;
  buds: number;
  needles: number;
  dead: number;
}
export function stats(s: State, fr = computeFrames(s)): Stats {
  let height = 0, shoots = 0, buds = 0, needles = 0, dead = 0;
  for (let i = 0; i < s.shoots.length; i++) {
    const sh = s.shoots[i];
    if (sh.dead) { dead++; continue; }
    shoots++;
    buds += sh.buds.length;
    needles += Math.round(sh.needleCount * sh.needleLive) * (sh.kind === 'shoot' ? 2 : 1);
    height = Math.max(height, fr.tip[i * 3 + 1]);
  }
  const baseDiameter = s.shoots.length ? 2 * radiusOf(s.shoots[0]) : 0;
  return { height, baseDiameter, shoots, buds, needles, dead };
}
