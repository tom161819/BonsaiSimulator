// Růstové jádro: jeden krok = jeden den. Čistá funkce nad stavem, bez vazby na vykreslování.

import type { Bud, BudKind, Shoot, State, Vec3 } from './types';
import { P, POT, POT_GROWTH_V1, RULES_LATEST, START_DOY, START_POT } from './params';
import { temperature } from './climate';
import { Species, speciesOf } from './species';
import { computeLight } from './light';
import {
  UP, YEAR, add, clamp, computeFrames, potCapFor, rootBoundFactor, doyOf, indexMap, norm, ownFoliage, rnd, scale, smooth, tilt, yearOf,
} from './util';

const potGrowth = (s: State) => (s.rules >= 2 ? POT[s.pot].growth : POT_GROWTH_V1[s.pot]);

export function createState(seed: number, rules = RULES_LATEST, species = 'pine'): State {
  return {
    seed, rules, species, day: START_DOY, gdd: 0, nextId: 1, pot: 'training', stage: 'seed', shoots: [],
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
  const sp = speciesOf(s);
  if (sp.kind === 'leafy') {
    // dělohy: u většiny listnáčů dvě (nadzemní klíčení); dub klíčí podzemně a dělohy zůstávají v žaludu
    newShoot(s, {
      kind: 'hypocotyl', dir: norm([(rnd(s.seed, 1, 1) - 0.5) * 0.12, 1, (rnd(s.seed, 1, 2) - 0.5) * 0.12]),
      targetLen: sp.hypocotylLen * (0.85 + 0.3 * rnd(s.seed, 1, 3)), needleCount: sp.cotyledons, needleLen: sp.cotyledonLen,
      area: Math.PI * 0.05 * 0.05,
    });
    return;
  }
  const lean = (rnd(s.seed, 1, 1) - 0.5) * 0.12;
  newShoot(s, {
    kind: 'hypocotyl', dir: norm([lean, 1, (rnd(s.seed, 1, 2) - 0.5) * 0.12]),
    targetLen: P.hypocotylLen + rnd(s.seed, 1, 3) * 0.8,
    needleCount: 5 + Math.floor(rnd(s.seed, 1, 4) * 3), // dělohy: 4–7, nejčastěji 5–6
    needleLen: 2.2, area: Math.PI * 0.05 * 0.05,
  });
}

function startEpicotyl(s: State, hyp: Shoot) {
  const sp = speciesOf(s);
  if (sp.kind === 'leafy') {
    const len = sp.epicotylLen * (0.8 + 0.4 * rnd(s.seed, 2, 1)) * (0.6 + 0.4 * potGrowth(s));
    const per = sp.phyllotaxis === 'opposite' ? 2 : 1;
    newShoot(s, {
      kind: 'epicotyl', parent: hyp.id, dir: norm(add(hyp.dir, [0, 0.4, 0])), targetLen: len,
      needleCount: Math.max(2, Math.round(len / sp.internode) + 1) * per, needleLen: sp.leafLen * 0.6, area: Math.PI * 0.04 * 0.04,
    });
    return;
  }
  newShoot(s, {
    kind: 'epicotyl', parent: hyp.id, dir: norm(add(hyp.dir, [0, 0.4, 0])),
    targetLen: (P.epicotylLen + rnd(s.seed, 2, 1)) * (0.6 + 0.4 * potGrowth(s)),
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

interface Sink { i: number; kind: 'apex' | 'pinch' | 'back'; w: number; v: number; min?: number; }

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
  const own = new Float64Array(n), PS = new Float64Array(n); // vlastní produkce výhonu a produkce celého jeho větvení
  for (let i = 0; i < n; i++) { own[i] = ownFoliage(s, s.shoots[i]) * (0.25 + 0.75 * s.shoots[i].light); prod += own[i]; }
  for (let i = n - 1; i >= 0; i--) {
    PS[i] += own[i];
    const sh = s.shoots[i];
    if (sh.parent >= 0 && !sh.dead) PS[idx.get(sh.parent)!] += PS[i];
  }
  const auto = s.rules >= 3 ? P.branchAutonomy : 0;
  s.production = prod;
  const sp = speciesOf(s), leafy = sp.kind === 'leafy';
  // v5: semenáček a mladý stromek mají na jednotku olistění výrazně větší přírůst; s velikostí koruny výhoda mizí
  const juv = leafy && s.rules >= 5 ? 1 + sp.juvenile / (1 + prod / P.juvenileScale) : 1;
  const G = prod * (leafy ? sp.growthPerFoliage : P.growthPerFoliage) * juv * potGrowth(s)
    * rootBoundFactor(s) * (1 - P.stressGrowthLoss * Math.min(1, s.stress));
  s.budget = G;

  // hustá koruna: zastíněné vrcholy přestávají zakládat pupeny (ve v5 dřív, kvůli plynulosti hry)
  const crowded = n > (s.rules >= 5 ? 3500 : P.maxShoots);
  const lam = leafy ? sp.lambdaLateral : P.lambdaLateral;
  const sinks: Sink[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    if (sh.dead || sh.kind === 'hypocotyl') { sh.stimulus = 0; continue; }
    if (leafy) { leafySinks(s, sp, sh, i, kids, sinks, year, crowded); sh.stimulus = 0; continue; }
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

  // Borchert–Honda: Q se sčítá od vrcholů ke kořeni, rozpočet se dělí od kořene k vrcholům.
  // Vrcholy, na které vyjde méně než na životaschopný pupen, se vyřadí a rozpočet se rozdělí znovu mezi
  // zbylé – slabé pupeny zakrní ve prospěch silnějších, místo aby se energie stromu rozplynula.
  const Q = new Float64Array(n), V = new Float64Array(n);
  const rounds = s.rules >= 2 ? 4 : 1; // přerozdělení rozpočtu zakrnělých pupenů je až v pravidlech v2
  for (let round = 0; round < rounds; round++) {
    Q.fill(0); V.fill(0);
    for (let i = n - 1; i >= 0; i--) {
      for (const k of sinks[i]) Q[i] += k.w;
      const sh = s.shoots[i];
      if (sh.parent >= 0 && !sh.dead) Q[idx.get(sh.parent)!] += Q[i];
    }
    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      if (sh.dead) continue;
      if (sh.parent < 0) V[i] = G;
      const wKid = (c: number) => (s.shoots[c].isMain ? 1 - lam : lam) * Math.pow(Q[c], P.sinkExp);
      const wSink = (k: Sink) => (k.kind === 'apex' ? 1 - lam : lam) * Math.pow(k.w, P.sinkExp);
      let sum = 0;
      for (const c of kids[i]) sum += wKid(c);
      for (const k of sinks[i]) sum += wSink(k);
      if (sum <= 0) continue;
      // Soběstačnost větví (pravidla v3): část rozpočtu zůstává tam, kde ji jehličí vyrobilo, a jen zbytek se
      // dělí podle síly vrcholů. Dobře olistěná spodní větev se tak uživí, i když jí vrchol konkuruje.
      let pSum = 0;
      if (auto > 0) {
        for (const c of kids[i]) if (Q[c] > 0) pSum += PS[c];
        if (sinks[i].length) pSum += own[i];
      }
      const a = pSum > 0 ? auto : 0;
      for (const c of kids[i]) V[c] = V[i] * ((1 - a) * wKid(c) / sum + (a && Q[c] > 0 ? (a * PS[c]) / pSum : 0));
      for (const k of sinks[i]) k.v = V[i] * ((1 - a) * wSink(k) / sum + (a ? (a * own[i]) / pSum / sinks[i].length : 0));
    }
    let dropped = 0;
    if (round < rounds - 1) for (let i = 0; i < n; i++) {
      const keep = sinks[i].filter((k) => k.v >= P.minShoot || k.min);
      dropped += sinks[i].length - keep.length;
      sinks[i] = keep;
    }
    if (!dropped) break;
  }

  for (let i = 0; i < n; i++) for (const k of sinks[i]) (leafy ? expandLeafy(s, sp, s.shoots[i], k, year) : expandSink(s, s.shoots[i], k, year));
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
    const perN = o === 0 ? 3.0 : s.rules >= 2 ? 2.0 : 3.5; // i krátký výhon větve se větví – bez toho by v misce nevznikalo jemné větvení
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
    const nb = k.v < (s.rules >= 2 ? 0.9 : 1.5) ? 1 : Math.min(4, 2 + Math.floor(k.v / 7));
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

// ---------------------------------------------------------------- olistěné druhy (listnáče a modřín)

const nodesOf = (sp: Species, sh: Shoot) => Math.max(1, Math.round(sh.len / sp.internode)) * (sp.phyllotaxis === 'opposite' ? 2 : 1);

/** Kde na výhonu smí vzniknout pupen. Letorost nese pupeny v úžlabí listů; starší dřevo jen tam, kde
 *  zůstaly živé spící pupeny nebo krátké výhony (podle druhu obráží ochotně, nebo skoro vůbec). */
function leafySinks(s: State, sp: Species, sh: Shoot, i: number, kids: number[][], sinks: Sink[][], year: number, crowded: boolean) {
  const cur = sh.bornYear === year;
  if (cur) sh.dormant = nodesOf(sp, sh);
  if (sh.light < sp.lightDeath) { sh.dormant = 0; return; } // zastíněný úsek zakrní
  const canBud = (sh.dormant ?? 0) > 0;
  const tipFree = !kids[i].some((c) => s.shoots[c].attachT > 0.98) && !sh.buds.some((b) => b.t > 0.98);
  // v4: pahýl, který už obrazil, další pupeny u řezu nezakládá – pokračují jeho nové výhony
  const stubDone = s.rules >= 4 && !cur && sh.tipCut && kids[i].length > 0;
  // čím hustší koruna, tím víc světla vrchol potřebuje, aby založil pupen (velké stromy se samy prosvětlují)
  const need = s.rules >= 5 ? 0.5 + 0.42 * Math.min(1, (s.shoots.length - 3500) / 5000) : 0.5;
  if (tipFree && canBud && !stubDone && !(crowded && sh.light < need)) {
    const apex = cur && !sh.tipCut;
    // pahýl ochotně obrážejícího druhu vyraší, i když na něj podle síly vrcholů skoro nic nezbude
    const stub = !cur && sh.tipCut && sp.epicormic >= 0.5 ? 1.5 * sp.epicormic : undefined;
    sinks[i].push({ i, kind: apex ? 'apex' : 'pinch', w: sh.light * (apex ? 1 : P.weightPinch * (cur ? 1 : sp.epicormic)), v: 0, min: stub });
  }
  if (sh.stimulus > 0 && canBud && !tipFree && sh.light > 0.2) {
    const p = Math.min(0.9, sp.backbud * 0.6 * sh.stimulus) * sh.light * (cur || year - sh.bornYear <= 2 ? 1 : sp.epicormic);
    if (rnd(s.seed, sh.id, year * 31 + 5) < p) {
      const cnt = rnd(s.seed, sh.id, year * 31 + 6) < 0.4 ? 2 : 1;
      for (let k = 0; k < Math.min(cnt, sh.dormant ?? 0); k++) sinks[i].push({ i, kind: 'back', w: sh.light * P.weightBack * 1.5, v: 0 });
    }
  }
}

/** Směr úžlabního pupenu podle postavení listů: dvouřadé (habr, buk), šroubovité (dub, bříza, modřín), vstřícné (javor). */
function axilDir(s: State, sp: Species, sh: Shoot, rank: number, salt: number): Vec3 {
  const j = rnd(s.seed, sh.id, salt + rank * 3) - 0.5;
  const vertical = Math.abs(sh.dir[1]) > 0.86;
  let phi: number;
  if (sp.phyllotaxis === 'opposite') phi = (rank % 2) * Math.PI + (Math.floor(rank / 2) % 2) * (Math.PI / 2) + sh.id;
  else if (sp.phyllotaxis === 'distichous' && !vertical) phi = (rank % 2) * Math.PI + j * 0.35; // ploché vějíře větví
  else phi = rank * 2.39996 + sh.id * 1.7;
  return tilt(sh.dir, sp.branchAngle + j * 0.3, phi + j * 0.3);
}

function leafyTerminal(s: State, sp: Species, sh: Shoot, salt: number): Vec3 {
  const up = sh.order === 0 ? sp.apicalUp : 0.04;
  const w = sh.order === 0 ? 0.1 : 0.14; // listnáče rostou klikatěji než borovice
  return norm([
    sh.dir[0] + (rnd(s.seed, sh.id, salt) - 0.5) * 2 * w,
    sh.dir[1] + up + (rnd(s.seed, sh.id, salt + 1) - 0.5) * w,
    sh.dir[2] + (rnd(s.seed, sh.id, salt + 2) - 0.5) * 2 * w,
  ]);
}

function expandLeafy(s: State, sp: Species, sh: Shoot, k: Sink, year: number) {
  if (k.min) k.v = Math.max(k.v, k.min);
  const o = sh.order;
  const cap = o === 0 ? sp.maxLeader : sp.maxLateral;
  const salt = year * 131;
  const N = Math.max(1, sh.dormant ?? 1);
  const per = sp.phyllotaxis === 'opposite' ? 2 : 1;
  const nodes = Math.max(1, Math.ceil(N / per));
  // poloha pupenu podle pořadí od vrcholu: silné pupeny jsou nahoře (u dubu natěsnané u konce výhonu)
  const place = (rank: number) => clamp(1 - ((Math.floor(rank / per) + 0.5) / nodes) * (1 - 0.8 * sp.tipCluster), 0.12, 0.98);
  if (k.kind === 'apex') {
    const rho = sp.lateralRatio, dec = sp.lateralDecay;
    const maxN = Math.min(N, o === 0 ? sp.maxLaterals : Math.max(2, sp.maxLaterals - 2));
    let nl = 0, sum = 0;
    while (nl < maxN) {
      const s2 = sum + Math.pow(dec, nl);
      if ((rho * (k.v / (1 + rho * s2))) * Math.pow(dec, nl) < sp.minLateral) break;
      sum = s2; nl++;
    }
    const lt = Math.min(cap, k.v / (1 + rho * sum));
    if (lt < P.minShoot) return;
    addBud(s, sh, 'terminal', 1, leafyTerminal(s, sp, sh, salt + 10), lt, o, true);
    for (let j = 0; j < nl; j++) {
      const l = rho * lt * Math.pow(dec, j) * (0.85 + 0.3 * rnd(s.seed, sh.id, salt + 20 + j));
      addBud(s, sh, 'lateral', place(j), axilDir(s, sp, sh, j, salt + 40), Math.min(sp.maxLateral, l), o + 1, false);
    }
    sh.dormant = Math.max(0, N - nl);
  } else if (k.kind === 'pinch') {
    if (s.rules >= 4 && k.min) {
      // pahýl (v4): ze spících pupenů vyrazí několik výhonů po celé délce pahýlu, nejsilnější nejblíž řezu;
      // vyrůstají z boku, řezná plocha zůstává holá
      const nbs = 2 + Math.round(3 * sp.epicormic);
      const total = Math.max(k.v, nbs * 1.3 * sp.epicormic);
      let wsum = 0;
      for (let j = 0; j < nbs; j++) wsum += Math.pow(0.7, j);
      for (let j = 0; j < nbs; j++) {
        const t = clamp(0.94 - (j / nbs) * 0.62 - 0.06 * rnd(s.seed, sh.id, salt + 80 + j), 0.2, 0.94);
        const dir = tilt(sh.dir, j === 0 ? 0.5 : sp.branchAngle * 0.85, j * 2.39996 + sh.id);
        addBud(s, sh, 'pinch', t, dir, Math.min(cap, (total * Math.pow(0.7, j)) / wsum), j === 0 ? o : o + 1, j === 0);
      }
      sh.dormant = Math.max(0, N - nbs);
      return;
    }
    // po řezu vyraší nejvyšší zbylé pupeny; první převezme osu
    const nb = Math.min(N, k.v < 0.9 ? 1 : Math.min(3, 1 + Math.floor(k.v / 4)));
    const l = Math.min(cap, k.v / nb);
    for (let j = 0; j < nb; j++) {
      const dir = j === 0 && nb === 1 ? leafyTerminal(s, sp, sh, salt + 10) : axilDir(s, sp, sh, j, salt + 40);
      addBud(s, sh, 'pinch', j === 0 ? 1 : place(j), dir, l * (0.85 + 0.3 * rnd(s.seed, sh.id, salt + 20 + j)), j === 0 ? o : o + 1, j === 0);
    }
    sh.dormant = Math.max(0, N - nb);
  } else {
    const t = 0.25 + 0.6 * rnd(s.seed, sh.id, salt + 60 + sh.buds.length);
    addBud(s, sh, 'back', t, axilDir(s, sp, sh, sh.buds.length + 1, salt + 70), Math.min(P.maxBackShoot * 1.5, k.v), o + 1, false);
    sh.dormant = Math.max(0, N - 1);
  }
}

// listy na slabých a krátkých výhonech jsou menší jen mírně; hlavní zmenšení přináší malá nádoba
const leafSize = (sp: Species, s: State, len: number) => sp.leafLen * (0.72 + 0.28 * (1 - Math.exp(-len / 6))) * POT[s.pot].needle;

/** Z pupenu olistěného druhu vyroste výhon s listy v každém úžlabí. */
function leafyShoot(s: State, sp: Species, sh: Shoot, b: Bud, late: boolean) {
  const per = sp.phyllotaxis === 'opposite' ? 2 : 1;
  const r = sp.twig0 + sp.twigPerLen * b.len;
  newShoot(s, {
    parent: sh.id, attachT: b.t, dir: b.order === 0 && b.isMain ? norm(add(b.dir, [0, 1.5, 0])) : b.dir, order: b.order, isMain: b.isMain,
    targetLen: b.len, needleCount: Math.max(2, Math.round(b.len / sp.internode) + 1) * per, needleLen: leafSize(sp, s, b.len), area: Math.PI * r * r,
    // druhý růst po zaštípnutí začíná až teď, ne na jaře
    delay: late ? Math.max(0, s.gdd - sp.flushGdd) : (b.isMain ? 0 : 10) + rnd(s.seed, b.id, 3) * 30,
  });
}

function flushLeafy(s: State, sp: Species) {
  const year = yearOf(s.day);
  s.flushedYear = year;
  for (const sh of s.shoots.slice()) {
    if (sh.dead) continue;
    // loňské listí (i suché, které drželo přes zimu) je pryč; krátké výhony na starším dřevě raší znovu
    if (sh.kind !== 'hypocotyl' || year - sh.bornYear >= 1) {
      const age = year - sh.bornYear;
      const spurs = age >= 1 && age <= sp.spurYears && sh.light >= sp.lightDeath ? Math.round((sh.dormant ?? 0) * sp.spurLeaves) : 0;
      sh.needleCount = spurs;
      sh.needleLen = leafSize(sp, s, 2) * 0.85;
      sh.needleLive = spurs ? 1 : 0;
    }
    for (const b of sh.buds) leafyShoot(s, sp, sh, b, false);
    sh.buds = [];
  }
}

/** Stárnutí krátkých výhonů: po několika letech na dřevě zbude jen pár spících pupenů (nebo žádný). */
function ageSpurs(s: State, sp: Species) {
  const year = yearOf(s.day);
  for (const sh of s.shoots) {
    if (sh.dead || !sh.dormant) continue;
    if (year - sh.bornYear >= sp.spurYears) sh.dormant = sp.epicormic >= 0.5 ? Math.min(sh.dormant, 2) : sp.epicormic >= 0.2 && year - sh.bornYear < sp.spurYears + 4 ? Math.min(sh.dormant, 1) : 0;
  }
}

/** Jarní rašení: z každého pupenu vyroste výhon o délce předurčené loni v létě. */
function flush(s: State) {
  const lsp = speciesOf(s);
  if (lsp.kind === 'leafy') { flushLeafy(s, lsp); return; }
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
  const leafy = speciesOf(s).kind === 'leafy'; // listnáč žije i bez listí, dokud má živé pupeny
  for (let i = n - 1; i >= 0; i--) {
    const sh = s.shoots[i];
    if (sh.dead) continue;
    if (alive[i] || sh.buds.length || (sh.needleCount > 0 && sh.needleLive > 0.02) || (leafy && (sh.dormant ?? 0) > 0)) {
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
  const sagF = speciesOf(s).kind === 'leafy' ? speciesOf(s).sag : 1;
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
    const horiz = Math.sqrt(Math.max(0, 1 - d[1] * d[1]));
    // úhel > 0 sklání špičku dolů (prověšení), < 0 ji zvedá (napřimování náhradního vrcholu)
    let deg = 0;
    if (!sh.dead && lateralAxis && year > sh.bornYear && !sh.wire && d[1] > P.sagFloor && sh.area > 0) {
      deg = Math.min(P.sagMaxPerYear * sagF, (P.sagK * sagF * sh.fol * horiz) / sh.area);
    } else if (s.rules >= 3 && sh.heir && !sh.dead && !sh.wire && d[1] < P.heirUpDone) {
      // větev, která převzala vrchol, se tlakovým dřevem rok od roku zvedá ke svislici
      deg = -clamp(P.heirUpK / (1 + 6 * Math.sqrt(sh.area / Math.PI)), P.heirUpMin, P.heirUpMax);
    }
    if (Math.abs(deg) > 0.02 && horiz > 0.05) {
      const a = (deg * Math.PI) / 180;
      const ax = norm([d[2], 0, -d[0]]); // osa vodorovná, kolmá na větev
      const c = Math.cos(a), si = Math.sin(a), t = 1 - c;
      const r = [
        t * ax[0] * ax[0] + c, t * ax[0] * ax[1] - si * ax[2], t * ax[0] * ax[2] + si * ax[1],
        t * ax[0] * ax[1] + si * ax[2], t * ax[1] * ax[1] + c, t * ax[1] * ax[2] - si * ax[0],
        t * ax[0] * ax[2] - si * ax[1], t * ax[1] * ax[2] + si * ax[0], t * ax[2] * ax[2] + c,
      ];
      const p = pm ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
      m = [0, 1, 2].flatMap((row) => [0, 1, 2].map((colI) => r[row * 3] * p[colI] + r[row * 3 + 1] * p[3 + colI] + r[row * 3 + 2] * p[6 + colI]));
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

  const sp = speciesOf(s), leafy = sp.kind === 'leafy';
  const flushGdd = leafy ? sp.flushGdd : P.flushGdd, elongSpan = leafy ? sp.elongSpanGdd : P.elongSpanGdd;
  if (year > 0 && s.flushedYear < year && s.gdd >= flushGdd) flush(s);
  if (s.pendingFlush) {
    // druhý růst: pupeny vzniklé po letním zaštípnutí raší po několika týdnech
    let left = 0;
    for (const sh of s.shoots.slice()) {
      if (sh.dead || !sh.buds.some((b) => b.flushDay !== undefined)) continue;
      const due = sh.buds.filter((b) => b.flushDay !== undefined && b.flushDay <= s.day);
      for (const b of due) leafyShoot(s, sp, sh, b, true);
      sh.buds = sh.buds.filter((b) => !due.includes(b));
      left += sh.buds.filter((b) => b.flushDay !== undefined).length;
    }
    s.pendingFlush = left;
  }

  const cambium = s.gdd > P.cambiumStartGdd && s.gdd < P.cambiumEndGdd;
  if (cambium && (s.day % 7 === 0 || s.shoots[0].fol === 0)) updateFoliage(s);
  const shedding = doy >= P.shedStartDoy && doy < P.shedEndDoy;
  const shedRate = 1 / (P.shedEndDoy - P.shedStartDoy - 5);
  const kArea = (P.areaPerFoliage * (speciesOf(s).kind === 'leafy' ? speciesOf(s).thicken * (s.rules >= 5 ? 0.6 : 1) : 1) * dG) / (P.cambiumEndGdd - P.cambiumStartGdd);

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
      if (sh.area > sh.wire.area0 * (leafy ? sp.wireBite : P.wireBite)) sh.scar = true;
    }
    if (sh.elong) {
      let e: number;
      if (sh.kind === 'hypocotyl') {
        const a = s.day - sh.bornDay;
        e = smooth(a / P.hypocotylDays);
        if (a === P.epicotylDelayDays) startEpicotyl(s, sh);
        if (a < P.epicotylDelayDays) { sh.len = sh.targetLen * e; continue; }
      } else if (sh.kind === 'epicotyl') e = smooth((s.gdd - sh.gdd0) / P.epicotylGddSpan);
      else e = smooth((s.gdd - flushGdd - sh.delay) / elongSpan);
      sh.len = sh.targetLen * e;
      if (e >= 1 || sh.bornYear < year) { sh.len = sh.targetLen; sh.elong = false; }
    }
    if (cambium) sh.area += kArea * sh.fol;
    if (leafy) {
      // opad listí: celé olistění, u buku, habru a dubu část suchých listů zůstává do jara
      if (doy >= sp.colorDoy + 12 && doy < sp.fallDoy && sh.needleLive > sp.marcescent && sh.kind !== 'hypocotyl') sh.needleLive = Math.max(sp.marcescent, sh.needleLive - 1 / (sp.fallDoy - sp.colorDoy - 12));
      else if (sh.kind === 'hypocotyl' && doy >= sp.colorDoy && sh.needleLive > 0) sh.needleLive = Math.max(0, sh.needleLive - 0.05);
    } else if (shedding && sh.needleLive > 0) {
      const old = year - sh.bornYear >= (sh.kind === 'hypocotyl' ? 1 : P.needleRetention - 1);
      if (old || sh.shedding) sh.needleLive = Math.max(0, sh.needleLive - shedRate);
    }
  }

  const setNow = year === 0 ? doy >= P.seedlingBudSetDoy : s.gdd >= (leafy ? sp.budSetGdd : P.budSetGdd);
  if (s.budSetYear < year && setNow) { runBudSet(s); updateDeath(s); }
  if (doy === P.shedEndDoy) {
    for (const sh of s.shoots) sh.shedding = false;
    if (leafy) ageSpurs(s, sp);
    updateDeath(s);
    sag(s);
    dropDeadTwigs(s);
  }
}

export { YEAR, UP, scale, clamp };
