// Růstové jádro: jeden krok = jeden den. Čistá funkce nad stavem, bez vazby na vykreslování.

import type { Bud, BudKind, Shoot, State, Vec3 } from './types';
import { P, POT, START_DOY, START_POT } from './params';
import { temperature } from './climate';
import { computeLight } from './light';
import {
  UP, YEAR, add, clamp, computeFrames, potCapFor, rootBoundFactor, doyOf, indexMap, norm, ownFoliage, rnd, scale, smooth, tilt, yearOf,
} from './util';

export function createState(seed: number): State {
  return {
    seed, day: START_DOY, gdd: 0, nextId: 1, pot: 'training', stage: 'seed', shoots: [],
    flushedYear: 0, budSetYear: -1, budSetGdd: 0, production: 0, budget: 0,
    roots: 0, potCap: potCapFor(START_POT), potId: START_POT, nebari: [], stress: 0, repotDay: START_DOY,
  };
}

function newShoot(s: State, o: Partial<Shoot>): Shoot {
  const sh: Shoot = {
    id: s.nextId++, parent: -1, attachT: 1, dir: [0, 1, 0], order: 0, isMain: true, kind: 'shoot',
    bornYear: yearOf(s.day), bornDay: s.day, targetLen: 1, len: 0, elong: true, delay: 0, gdd0: s.gdd,
    needleCount: 0, needleLen: 0, needleLive: 1, shedding: false, area: 0, dead: false, deadYear: -1,
    tipCut: false, stimulus: 0, light: 1, fol: 0, wire: null, arc: null, scar: false, male: false, cone: false, buds: [], ...o,
  };
  s.shoots.push(sh);
  return sh;
}

const r0Area = (len: number) => {
  const r = P.shootRadius0 + P.shootRadiusPerLen * len;
  return Math.PI * r * r;
};

// ---------------------------------------------------------------- semenáček

function germinate(s: State) {
  s.stage = 'growing';
  // povrchové kořeny: 5–7 směrů, nestejně dlouhé a silné (pěstitel je může při přesazení rozprostřít)
  const cnt = 5 + Math.floor(rnd(s.seed, 501, 1) * 3);
  for (let k = 0; k < cnt; k++) s.nebari.push({
    az: (k / cnt) * 6.2832 + (rnd(s.seed, 502, k) - 0.5) * 0.9,
    len: 2.4 + 2.8 * rnd(s.seed, 503, k), thick: 0.34 + 0.22 * rnd(s.seed, 504, k), id: k,
  });
  const lean = (rnd(s.seed, 1, 1) - 0.5) * 0.12;
  newShoot(s, {
    kind: 'hypocotyl', dir: norm([lean, 1, (rnd(s.seed, 1, 2) - 0.5) * 0.12]),
    targetLen: P.hypocotylLen + rnd(s.seed, 1, 3) * 0.8,
    needleCount: 5 + Math.floor(rnd(s.seed, 1, 4) * 3), // dělohy: 4–7, nejčastěji 5–6
    needleLen: 2.2, area: Math.PI * 0.05 * 0.05,
  });
}

function startEpicotyl(s: State, hyp: Shoot) {
  newShoot(s, {
    kind: 'epicotyl', parent: hyp.id, dir: norm(add(hyp.dir, [0, 0.4, 0])),
    targetLen: (P.epicotylLen + rnd(s.seed, 2, 1)) * (0.6 + 0.4 * POT[s.pot].growth),
    needleCount: 24 + Math.floor(rnd(s.seed, 2, 2) * 10), needleLen: 2.0, area: Math.PI * 0.04 * 0.04,
  });
}

// ---------------------------------------------------------------- směry růstu

function terminalDir(s: State, sh: Shoot, salt: number): Vec3 {
  const up = sh.order === 0 ? 0.35 : 0.05; // kmen se vrací ke svislici, špičky větví se zvedají jen mírně
  const w = sh.order === 0 ? 0.07 : 0.11;
  return norm([
    sh.dir[0] + (rnd(s.seed, sh.id, salt) - 0.5) * 2 * w,
    sh.dir[1] + up + (rnd(s.seed, sh.id, salt + 1) - 0.5) * w,
    sh.dir[2] + (rnd(s.seed, sh.id, salt + 2) - 0.5) * 2 * w,
  ]);
}

const SIDE_PHI = [0, Math.PI, Math.PI / 3, (2 * Math.PI) / 3, Math.PI / 2];

/** Boční pupeny: na svislé ose pravidelný přeslen, na větvi hlavně do stran a mírně nahoru. */
function lateralDir(s: State, sh: Shoot, i: number, n: number, theta: number, salt: number): Vec3 {
  const j = (rnd(s.seed, sh.id, salt + i * 3) - 0.5);
  const vertical = Math.abs(sh.dir[1]) > 0.86;
  let phi: number;
  if (vertical) phi = rnd(s.seed, sh.id, salt + 99) * 6.283 + (i * 6.283) / n + j * 0.5;
  else {
    const flip = rnd(s.seed, sh.id, salt + 98) < 0.5 ? 0 : 1;
    phi = SIDE_PHI[(i + (n === 1 ? flip : 0)) % SIDE_PHI.length] + j * 0.6;
  }
  return tilt(sh.dir, theta + j * 0.25, phi);
}

// ---------------------------------------------------------------- pupeny

interface Sink { i: number; kind: 'apex' | 'pinch' | 'back'; w: number; v: number; }

/** Zakládání pupenů (červenec): rozdělí růstový rozpočet stromu mezi růstové vrcholy
 *  a uloží do pupenů předurčenou délku příštích výhonů. */
function runBudSet(s: State) {
  const year = yearOf(s.day);
  s.budSetYear = year;
  s.budSetGdd = s.gdd;
  const fr = computeFrames(s);
  computeLight(s, fr);
  const n = s.shoots.length;
  const idx = fr.index;
  const kids: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const p = s.shoots[i].parent;
    if (p >= 0 && !s.shoots[i].dead) kids[idx.get(p)!].push(i);
  }

  // produkce = osluněné olistění; rozpočet = kolik cm nových výhonů strom příští rok utáhne
  let prod = 0;
  for (const sh of s.shoots) prod += ownFoliage(s, sh) * (0.25 + 0.75 * sh.light);
  s.production = prod;
  const pot = POT[s.pot];
  const G = prod * P.growthPerFoliage * pot.growth
    * rootBoundFactor(s) * (1 - P.stressGrowthLoss * Math.min(1, s.stress));
  s.budget = G;

  const crowded = n > P.maxShoots;
  const sinks: Sink[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    if (sh.dead || sh.kind === 'hypocotyl') { sh.stimulus = 0; continue; }
    const hasNeedles = sh.needleCount > 0 && sh.needleLive > 0.3;
    const tipFree = !kids[i].some((c) => s.shoots[c].attachT > 0.98) && !sh.buds.some((b) => b.t > 0.98);
    if (sh.light < P.lightDeath) sh.shedding = true;
    else if (hasNeedles && tipFree && !(crowded && sh.light < 0.5)) {
      const apex = !sh.tipCut && sh.bornYear === year;
      sinks[i].push({ i, kind: apex ? 'apex' : 'pinch', w: sh.light * (apex ? 1 : P.weightPinch), v: 0 });
    }
    // zpětné rašení: jen na dřevě, které ještě nese jehlice, a jen po řezu v okolí
    if (sh.stimulus > 0 && hasNeedles && !tipFree && year - sh.bornYear <= 2 && sh.light > 0.3) {
      const p = Math.min(0.85, 0.45 * sh.stimulus) * sh.light;
      if (rnd(s.seed, sh.id, year * 31 + 5) < p) {
        const cnt = rnd(s.seed, sh.id, year * 31 + 6) < 0.35 ? 2 : 1;
        for (let k = 0; k < cnt; k++) sinks[i].push({ i, kind: 'back', w: sh.light * P.weightBack, v: 0 });
      }
    }
    sh.stimulus = 0;
  }

  // Borchert–Honda: Q se sčítá od vrcholů ke kořeni, rozpočet se dělí od kořene k vrcholům
  const Q = new Float64Array(n), V = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    for (const k of sinks[i]) Q[i] += k.w;
    const sh = s.shoots[i];
    if (sh.parent >= 0 && !sh.dead) Q[idx.get(sh.parent)!] += Q[i];
  }
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    if (sh.dead) continue;
    if (sh.parent < 0) V[i] = G;
    const wKid = (c: number) => (s.shoots[c].isMain ? 1 - P.lambdaLateral : P.lambdaLateral) * Math.pow(Q[c], P.sinkExp);
    const wSink = (k: Sink) => (k.kind === 'apex' ? 1 - P.lambdaLateral : P.lambdaLateral) * Math.pow(k.w, P.sinkExp);
    let sum = 0;
    for (const c of kids[i]) sum += wKid(c);
    for (const k of sinks[i]) sum += wSink(k);
    if (sum <= 0) continue;
    for (const c of kids[i]) V[c] = (V[i] * wKid(c)) / sum;
    for (const k of sinks[i]) k.v = (V[i] * wSink(k)) / sum;
  }

  for (let i = 0; i < n; i++) for (const k of sinks[i]) expandSink(s, s.shoots[i], k, year);
}

function addBud(s: State, sh: Shoot, kind: BudKind, t: number, dir: Vec3, len: number, order: number, isMain: boolean) {
  if (len < P.minShoot) return;
  const b: Bud = { id: s.nextId++, kind, t, dir, len, order, isMain };
  sh.buds.push(b);
}

function expandSink(s: State, sh: Shoot, k: Sink, year: number) {
  const o = sh.order;
  const cap = o === 0 ? P.maxLeader : P.maxLateral;
  const salt = year * 131;
  if (k.kind === 'apex') {
    // terminální pupen + přeslen bočních; počet bočních roste s vitalitou vrcholu
    const maxN = o === 0 ? 6 : o === 1 ? 4 : 3;
    const perN = o === 0 ? 3.0 : 3.5;
    const rho = o === 0 ? P.whorlRatioTrunk : P.whorlRatioBranch;
    let nl = 0;
    while (nl < maxN && k.v / (1 + rho * (nl + 1)) >= perN * (nl + 1)) nl++;
    const r = rnd(s.seed, sh.id, salt + 1);
    if (r < 0.22 && nl > 0) nl--;
    else if (r > 0.86 && nl < maxN && k.v > 4) nl++;
    const lt = Math.min(cap, k.v / (1 + rho * nl));
    if (lt < P.minShoot) return;
    addBud(s, sh, 'terminal', 1, terminalDir(s, sh, salt + 10), lt, o, true);
    const theta = o === 0 ? 1.0 : 0.75; // ~57° od kmene, ~43° od větve
    for (let i = 0; i < nl; i++) {
      const l = rho * lt * (0.8 + 0.4 * rnd(s.seed, sh.id, salt + 20 + i));
      addBud(s, sh, 'lateral', 1, lateralDir(s, sh, i, nl, theta, salt + 40), Math.min(P.maxLateral, l), o + 1, false);
    }
  } else if (k.kind === 'pinch') {
    // po zaštípnutí/řezu: několik rovnocenných pupenů ze svazečků jehlic u řezu, bez dominantního terminálu
    const nb = k.v < 1.5 ? 1 : Math.min(4, 2 + Math.floor(k.v / 7));
    const l = Math.min(cap, k.v / nb);
    for (let i = 0; i < nb; i++) {
      const dir = nb === 1 ? terminalDir(s, sh, salt + 10) : lateralDir(s, sh, i, nb, 0.42, salt + 40);
      addBud(s, sh, 'pinch', 1, dir, l * (0.85 + 0.3 * rnd(s.seed, sh.id, salt + 20 + i)), i === 0 ? o : o + 1, i === 0);
    }
  } else {
    const t = 0.3 + 0.6 * rnd(s.seed, sh.id, salt + 60 + sh.buds.length);
    const dir = lateralDir(s, sh, sh.buds.length, 2, 0.8, salt + 70);
    addBud(s, sh, 'back', t, dir, Math.min(P.maxBackShoot, k.v), o + 1, false);
  }
}

/** Jarní rašení: z každého pupenu vyroste výhon o délce předurčené loni v létě. */
function flush(s: State) {
  const year = yearOf(s.day);
  s.flushedYear = year;
  const pot = POT[s.pot];
  for (const sh of s.shoots.slice()) {
    if (sh.dead || !sh.buds.length) continue;
    for (const b of sh.buds) {
      const l = b.len;
      const nl = (P.needleLenMin + P.needleLenGain * (1 - Math.exp(-l / P.needleLenScale))) * pot.needle;
      newShoot(s, {
        // měkká svíčka kmene se gravitropicky napřímí během dnů, i když je strom nakloněný
        parent: sh.id, attachT: b.t, dir: b.order === 0 && b.isMain ? norm(add(b.dir, [0, 1.5, 0])) : b.dir, order: b.order, isMain: b.isMain,
        targetLen: l, needleCount: Math.round(8 + 5 * l), needleLen: nl, area: r0Area(l),
        delay: (b.isMain ? 0 : 15) + rnd(s.seed, b.id, 3) * 25 + b.order * 5,
        male: year >= P.coneMinAge && b.order >= 1 && l < 7 && rnd(s.seed, b.id, 8) < P.maleChance,
        cone: year >= P.coneMinAge && l >= 7 && rnd(s.seed, b.id, 9) < P.femaleChance,
      });
    }
    sh.buds = [];
  }
}

// ---------------------------------------------------------------- odumírání

/** Výhon žije, dokud on nebo jeho podstrom nese živé jehlice či pupeny.
 *  Borovice z holého dřeva neobráží – větev bez jehlic odumře. */
export function updateDeath(s: State) {
  const n = s.shoots.length;
  const idx = indexMap(s);
  const alive = new Uint8Array(n);
  const year = yearOf(s.day);
  for (let i = n - 1; i >= 0; i--) {
    const sh = s.shoots[i];
    if (sh.dead) continue;
    if (alive[i] || sh.buds.length || (sh.needleCount > 0 && sh.needleLive > 0.02)) {
      alive[i] = 1;
      if (sh.parent >= 0) alive[idx.get(sh.parent)!] = 1;
    } else {
      sh.dead = true; sh.deadYear = year; sh.elong = false; sh.needleLive = 0;
    }
  }
  if (s.stage === 'growing' && n > 0 && !alive[0]) s.stage = 'dead';
}

/** Tenké suché větvičky po dvou letech opadnou; silnější suché dřevo zůstává (budoucí jin). */
function dropDeadTwigs(s: State) {
  const year = yearOf(s.day);
  const hasKid = new Set<number>();
  const keep: Shoot[] = [];
  for (let i = s.shoots.length - 1; i >= 0; i--) {
    const sh = s.shoots[i];
    const drop = sh.dead && sh.parent >= 0 && !hasKid.has(sh.id) && year - sh.deadYear >= 2 && sh.area < 0.5;
    if (drop) continue;
    hasKid.add(sh.parent);
    keep.push(sh);
  }
  s.shoots = keep.reverse();
}

/** Prověšování: boční větve se každý rok o něco skloní pod vahou jehličí. Tenká větev s velkou zátěží
 *  klesá nejvíc, zesílená už drží; nadrátovaná větev drží tvar daný drátem. Jeden průchod od kořene:
 *  každý výhon nese složené otočení svých předků. */
function sag(s: State) {
  const n = s.shoots.length;
  const idx = indexMap(s);
  const year = yearOf(s.day);
  // matice 3×3 po řádcích; null = beze změny
  const M: (number[] | null)[] = new Array(n).fill(null);
  const mul = (m: number[] | null, v: Vec3): Vec3 => (m ? [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]] : v);
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    const pm = sh.parent >= 0 ? M[idx.get(sh.parent)!] : null;
    let m = pm;
    const d = mul(pm, sh.dir);
    const lateralAxis = sh.order >= 1;
    if (!sh.dead && lateralAxis && year > sh.bornYear && !sh.wire && d[1] > P.sagFloor && sh.area > 0) {
      const horiz = Math.sqrt(Math.max(0, 1 - d[1] * d[1]));
      const deg = Math.min(P.sagMaxPerYear, (P.sagK * sh.fol * horiz) / sh.area);
      if (deg > 0.02 && horiz > 0.05) {
        const a = (deg * Math.PI) / 180;
        // osa vodorovná, kolmá na větev; otočení skloní špičku dolů
        const ax = norm([d[2], 0, -d[0]]);
        const c = Math.cos(a), si = Math.sin(a), t = 1 - c;
        const r = [
          t * ax[0] * ax[0] + c, t * ax[0] * ax[1] - si * ax[2], t * ax[0] * ax[2] + si * ax[1],
          t * ax[0] * ax[1] + si * ax[2], t * ax[1] * ax[1] + c, t * ax[1] * ax[2] - si * ax[0],
          t * ax[0] * ax[2] - si * ax[1], t * ax[1] * ax[2] + si * ax[0], t * ax[2] * ax[2] + c,
        ];
        const p = pm ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
        m = [0, 1, 2].flatMap((row) => [0, 1, 2].map((colI) => r[row * 3] * p[colI] + r[row * 3 + 1] * p[3 + colI] + r[row * 3 + 2] * p[6 + colI]));
      }
    }
    M[i] = m;
    if (!m) continue;
    sh.dir = norm(mul(m, sh.dir));
    for (const b of sh.buds) b.dir = norm(mul(m, b.dir));
    if (sh.wire) sh.wire.axis = norm(mul(m, sh.wire.axis));
    if (sh.arc) sh.arc.axis = norm(mul(m, sh.arc.axis));
  }
}

function updateFoliage(s: State) {
  const n = s.shoots.length;
  const idx = indexMap(s);
  for (const sh of s.shoots) sh.fol = ownFoliage(s, sh) * (0.25 + 0.75 * sh.light);
  for (let i = n - 1; i > 0; i--) {
    const sh = s.shoots[i];
    if (sh.parent >= 0) s.shoots[idx.get(sh.parent)!].fol += sh.fol;
  }
}

// ---------------------------------------------------------------- denní krok

export function step(s: State) {
  s.day++;
  const year = yearOf(s.day), doy = doyOf(s.day);
  if (doy === 0) s.gdd = 0;
  const dG = Math.max(0, temperature(s.seed, year, doy) - P.baseTemp);
  s.gdd += dG;

  if (s.stage === 'seed') {
    if (s.gdd >= P.germGdd) germinate(s);
    return;
  }
  if (s.stage === 'dead') return;

  if (year > 0 && s.flushedYear < year && s.gdd >= P.flushGdd) flush(s);

  const cambium = s.gdd > P.cambiumStartGdd && s.gdd < P.cambiumEndGdd;
  if (cambium && (s.day % 7 === 0 || s.shoots[0].fol === 0)) updateFoliage(s);
  const shedding = doy >= P.shedStartDoy && doy < P.shedEndDoy;
  const shedRate = 1 / (P.shedEndDoy - P.shedStartDoy - 5);
  const kArea = (P.areaPerFoliage * dG) / (P.cambiumEndGdd - P.cambiumStartGdd);

  if (cambium) {
    // kořeny rostou s olistěním, dokud je v nádobě místo; stres z přesazení postupně odeznívá
    const season = dG / (P.cambiumEndGdd - P.cambiumStartGdd);
    if (s.pot !== 'ground') s.roots += P.rootGrowth * s.shoots[0].fol * season * Math.max(0, 1 - s.roots / (s.potCap * P.rootMaxFill));
    s.stress *= 1 - P.stressDecay * season;
  }
  const setRate = cambium ? dG / (P.cambiumEndGdd - P.cambiumStartGdd) : 0;

  for (let i = 0, n = s.shoots.length; i < n; i++) {
    const sh = s.shoots[i];
    if (sh.dead) continue;
    if (sh.wire && cambium) {
      // tvar fixují nové letokruhy: silnější dřevo potřebuje víc sezón; drát mezitím zarůstá
      const r = Math.sqrt(sh.area / Math.PI);
      sh.wire.set = Math.min(1, sh.wire.set + setRate / (P.wireMinSeasons + P.wireSeasonsPerCm * r));
      if (sh.area > sh.wire.area0 * P.wireBite) sh.scar = true;
    }
    if (sh.elong) {
      let e: number;
      if (sh.kind === 'hypocotyl') {
        const a = s.day - sh.bornDay;
        e = smooth(a / P.hypocotylDays);
        if (a === P.epicotylDelayDays) startEpicotyl(s, sh);
        if (a < P.epicotylDelayDays) { sh.len = sh.targetLen * e; continue; }
      } else if (sh.kind === 'epicotyl') e = smooth((s.gdd - sh.gdd0) / P.epicotylGddSpan);
      else e = smooth((s.gdd - P.flushGdd - sh.delay) / P.elongSpanGdd);
      sh.len = sh.targetLen * e;
      if (e >= 1 || sh.bornYear < year) { sh.len = sh.targetLen; sh.elong = false; }
    }
    if (cambium) sh.area += kArea * sh.fol;
    if (shedding && sh.needleLive > 0) {
      const old = year - sh.bornYear >= (sh.kind === 'hypocotyl' ? 1 : P.needleRetention - 1);
      if (old || sh.shedding) sh.needleLive = Math.max(0, sh.needleLive - shedRate);
    }
  }

  const setNow = year === 0 ? doy >= P.seedlingBudSetDoy : s.gdd >= P.budSetGdd;
  if (s.budSetYear < year && setNow) { runBudSet(s); updateDeath(s); }
  if (doy === P.shedEndDoy) {
    for (const sh of s.shoots) sh.shedding = false;
    updateDeath(s);
    sag(s);
    dropDeadTwigs(s);
  }
}

export { YEAR, UP, scale, clamp };
