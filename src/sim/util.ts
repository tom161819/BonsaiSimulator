import type { Shoot, State, SurfaceRoot, Vec3 } from './types';
import { P, potById } from './params';
import { speciesOf } from './species';

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
  const sp = speciesOf(s);
  if (sp.kind === 'leafy') {
    if (sh.kind === 'hypocotyl') return smooth((s.day - sh.bornDay - 6) / 16);
    // listy raší každé jaro znovu – i na krátkých výhonech starého dřeva
    const start = sh.bornYear === yearOf(s.day) ? sp.flushGdd + sh.delay : sp.flushGdd;
    return sh.kind === 'epicotyl' ? 0.3 + 0.7 * smooth((s.gdd - sh.gdd0) / 500) : smooth((s.gdd - start) / sp.leafSpanGdd);
  }
  if (sh.bornYear < yearOf(s.day)) return 1;
  if (sh.kind === 'hypocotyl') return smooth((s.day - sh.bornDay - 6) / 16);
  if (sh.kind === 'epicotyl') return 0.25 + 0.75 * smooth((s.gdd - sh.gdd0) / P.epicotylGddSpan);
  return smooth((s.gdd - P.needleStartGdd - sh.delay) / P.needleSpanGdd);
}

/** Vlastní olistění výhonu v jednotkách "1 cm výhonu s 5 svazečky 5cm jehlic". */
export function ownFoliage(s: State, sh: Shoot): number {
  if (sh.dead || sh.needleCount === 0 || sh.needleLive <= 0) return 0;
  const sp = speciesOf(s);
  if (sp.kind === 'leafy') {
    if (doyOf(s.day) >= sp.colorDoy) return 0; // barvící se a suché listí už nepracuje
    const size = sh.needleLen / sp.leafLen;
    const juv = sh.kind === 'shoot' ? 1 : 1.6;
    return sh.needleCount * sp.leafUnits * size * size * Math.max(0.15, needleGrowth(s, sh)) * sh.needleLive * juv;
  }
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

/** Rozprostření povrchových kořenů: rovnoměrnější rozestupy kolem kmene a vyrovnanější délky. Vrací kopie. */
export function spreadNebari(list: SurfaceRoot[], spread: number): SurfaceRoot[] {
  const k = clamp(spread, 0, 1);
  const sorted = list.map((r) => ({ ...r })).sort((x, y) => x.az - y.az);
  if (!sorted.length || k === 0) return sorted;
  const a0 = sorted[0].az, mean = sorted.reduce((t, r) => t + r.len, 0) / sorted.length;
  sorted.forEach((r, i) => { r.az += (a0 + (i / sorted.length) * 6.2832 - r.az) * k; r.len += (mean - r.len) * k * 0.6; });
  return sorted;
}

/** Zaplnění nádoby kořeny (1 = plná). */
export const rootFill = (s: State) => (s.pot === 'ground' ? 0 : s.roots / Math.max(1, s.potCap));

/** Násobitel růstu podle prokořenění: přerostlé kořeny strom dusí. */
export function rootBoundFactor(s: State): number {
  const f = rootFill(s);
  if (s.rules >= 9) {
    // v9: plynulá křivka, která při přeplnění klesá skoro k nule
    const p = P.rootCurve9;
    if (f <= p[0][0]) return 1;
    for (let i = 1; i < p.length; i++) if (f <= p[i][0]) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (f - p[i - 1][0])) / (p[i][0] - p[i - 1][0]);
    return p[p.length - 1][1];
  }
  if (f <= P.rootBoundStart) return 1;
  return Math.max(P.rootBoundMin, 1 - ((1 - P.rootBoundMin) * (f - P.rootBoundStart)) / (P.rootBoundFull - P.rootBoundStart));
}

/** v9: vyčerpání substrátu. Po letech v přerostlé nádobě strom chřadne: 1 = v pořádku, 0 = konec. */
export const potExhaust = (s: State) => (s.rules >= 9 && s.pot !== 'ground' ? 1 - clamp(((s.bound ?? 0) - P.boundGrace9) / P.boundSpan9, 0, 1) : 1);

/** Stav nádoby pro hráče: 0 v pořádku, 1 plná (růst slábne), 2 přerostlá (strom stagnuje), 3 strom chřadne. */
export function potStatus(s: State): 0 | 1 | 2 | 3 {
  if (s.pot === 'ground' || s.stage !== 'growing') return 0;
  const f = rootFill(s);
  if (s.rules >= 9) return (s.bound ?? 0) > P.boundGrace9 ? 3 : f >= P.boundFull9 || (s.bound ?? 0) >= 1 ? 2 : f >= 1 ? 1 : 0;
  return f > 1.2 ? 2 : f > P.rootBoundStart ? 1 : 0;
}

/** Bezpečný úhel ohybu výhonu drátem (rad): tenké dřevo se ohne hodně, silné málo. */
export function bendLimit(s: State, sh: Shoot, z = 0): number {
  const r = radiusOf(sh);
  const v6 = s.rules >= 6;
  const bMin = v6 ? P.bendMin6 : P.bendMin;
  let deg = clamp((v6 ? P.bendK6 : P.bendK) / (r + 0.25), bMin, P.bendMax);
  // plynulý oblouk namáhá dřevo méně než zlom: mez určuje poloměr ohybu vůči síle větve
  if (z > 0) deg = clamp(Math.max(deg, ((z * sh.len * (v6 ? P.bendStrain6 : P.bendStrain)) / Math.max(r, 0.03)) * (180 / Math.PI)), bMin, P.bendArcMax);
  if (s.gdd >= P.flushGdd && s.gdd < P.budSetGdd) deg *= v6 ? P.bendSpringFactor6 : P.bendSpringFactor;
  return (deg * Math.PI) / 180;
}

/** Pokryvnost mechu 0..1: po sezoně náznak (~10 %), po roce třetina, po dvou letech celá miska. */
export const MOSS_FULL_DAYS = 730;
export const mossCover = (s: State) => (s.pot === 'ground' ? 0 : Math.min(1, Math.pow((s.mossAge ?? 0) / MOSS_FULL_DAYS, 1.6)));

/** Oblouk, který dřevo už samo drží: bez drátu celý, pod drátem jen zdřevnatělý podíl (od výchozího tvaru). */
export function heldArc(sh: Shoot): { axis: Vec3; angle: number; z: number } | null {
  const a = sh.arc;
  if (!a) return null;
  const w = sh.wire;
  if (!w || w.z <= 0) return a;
  const f = w.from, k = w.set;
  const v: Vec3 = [0, 1, 2].map((i) => (f ? f.axis[i] * f.angle * (1 - k) : 0) + a.axis[i] * a.angle * k) as Vec3;
  const ang = Math.hypot(v[0], v[1], v[2]);
  if (ang < 1e-4) return null;
  return { axis: [v[0] / ang, v[1] / ang, v[2] / ang], angle: ang, z: f ? f.z + (a.z - f.z) * k : a.z };
}

/** Namáhání dřeva při ohybu obloukem (v8): počítá se jen změna proti tvaru, který větev už drží.
 *  Zarostlý ohyb z dřívějšího drátování je nový výchozí stav. */
export function bendStress(s: State, sh: Shoot, axis: Vec3, angle: number, z: number): number {
  if (s.rules < 8 || z <= 0) return angle;
  const h = heldArc(sh);
  if (!h) return angle;
  return Math.hypot(axis[0] * angle - h.axis[0] * h.angle, axis[1] * angle - h.axis[1] * h.angle, axis[2] * angle - h.axis[2] * h.angle);
}

/** Pravděpodobnost prasknutí při ohybu o daný úhel (s osou: v8 počítá jen ohyb navíc proti drženému tvaru). */
export const breakRisk = (s: State, sh: Shoot, angle: number, z = 0, axis?: Vec3) => {
  const safe = bendLimit(s, sh, z);
  if (axis) angle = bendStress(s, sh, axis, angle, z);
  return clamp((angle - safe) / ((s.rules >= 6 ? P.bendRamp6 : 0.5) * safe), 0, 1);
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
    needles += Math.round(sh.needleCount * sh.needleLive) * (sh.kind === 'shoot' && speciesOf(s).kind === 'pine' ? 2 : 1);
    height = Math.max(height, fr.tip[i * 3 + 1]);
  }
  const baseDiameter = s.shoots.length ? 2 * radiusOf(s.shoots[0]) : 0;
  return { height, baseDiameter, shoots, buds, needles, dead };
}
