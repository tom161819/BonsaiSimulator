// Zásahy pěstitele. Každý zásah je malý záznam {den, typ, cíl}; strom = f(semínko, seznam zásahů, datum).

import type { Action, Shoot, State, Vec3 } from './types';
import { P, defaultPotId, potById } from './params';
import { updateDeath } from './growth';
import { breakRisk, norm, potCapFor, repotStress, rnd, rotate, yearOf } from './util';

function removeSubtrees(s: State, roots: Set<number>) {
  if (!roots.size) return;
  const gone = new Set(roots);
  const keep: Shoot[] = [];
  for (const sh of s.shoots) {
    if (gone.has(sh.id) || gone.has(sh.parent)) gone.add(sh.id);
    else keep.push(sh);
  }
  s.shoots = keep;
}

/** Otočí výhon a celý jeho podstrom (směry, pupeny i osy drátů). id < 0 = celý strom. */
function rotateSubtree(s: State, id: number, axis: Vec3, angle: number, skipOwnWire = false) {
  if (Math.abs(angle) < 1e-6) return;
  const inSub = new Set<number>();
  for (const sh of s.shoots) {
    if (id >= 0 && sh.id !== id && !inSub.has(sh.parent)) continue;
    inSub.add(sh.id);
    sh.dir = norm(rotate(sh.dir, axis, angle));
    for (const b of sh.buds) b.dir = norm(rotate(b.dir, axis, angle));
    if (sh.wire && !(skipOwnWire && sh.id === id)) sh.wire.axis = norm(rotate(sh.wire.axis, axis, angle));
    if (sh.arc) sh.arc.axis = norm(rotate(sh.arc.axis, axis, angle));
  }
}

/** Zaštípnutí svíčky / řez výhonu v místě t (0..1 jeho délky); t ≈ 0 odstraní celý výhon. */
function cut(s: State, id: number, t: number) {
  const sh = s.shoots.find((x) => x.id === id);
  if (!sh) return;
  const parent = s.shoots.find((x) => x.id === sh.parent);
  if (parent) {
    parent.stimulus += 1;
    const gp = s.shoots.find((x) => x.id === parent.parent);
    if (gp) gp.stimulus += 0.5;
  }
  if (t <= 0.02 && sh.parent >= 0) {
    removeSubtrees(s, new Set([id]));
  } else {
    t = Math.max(t, 0.02);
    const gone = new Set<number>();
    for (const c of s.shoots) if (c.parent === id && c.attachT > t) gone.add(c.id);
    removeSubtrees(s, gone);
    sh.buds = sh.buds.filter((b) => b.t <= t);
    if (sh.kind === 'hypocotyl') sh.needleCount = 0; // dělohy sedí na vrcholu
    else {
      const bare = sh.kind === 'shoot' ? P.bareBase : 0;
      sh.needleCount = Math.round((sh.needleCount * Math.max(0, t - bare)) / (1 - bare));
    }
    for (const a of [sh.arc, sh.wire && sh.wire.z > 0 ? sh.wire : null]) {
      // řez v oblouku: zbude jen jeho začátek
      if (!a) continue;
      if (t < a.z) { a.angle *= t / a.z; a.z = 1; } else a.z = Math.min(1, a.z / t);
    }
    sh.targetLen *= t;
    sh.len *= t;
    for (const c of s.shoots) if (c.parent === id) c.attachT /= t;
    for (const b of sh.buds) b.t /= t;
    sh.tipCut = true;
    sh.stimulus += 1;
  }
  updateDeath(s);
}

/** Stočí vše, co na výhonu roste, o podíl úhlu podle místa nasazení na oblouku. */
function turnAlongArc(s: State, sh: Shoot, axis: Vec3, angle: number, z: number) {
  const f = (t: number) => angle * Math.min(1, t / Math.max(z, 1e-3));
  for (const c of s.shoots.filter((x) => x.parent === sh.id)) rotateSubtree(s, c.id, axis, f(c.attachT));
  for (const b of sh.buds) b.dir = norm(rotate(b.dir, axis, f(b.t)));
}

/** Samotná geometrie ohybu (bez drátu a bez rizika) – používá ji i náhled při tažení.
 *  z = 0: zlom v místě nasazení; z > 0: oblouk přes podíl z délky výhonu (nahradí dřívější oblouk). */
export function bendShoot(s: State, id: number, axis: Vec3, angle: number, z: number) {
  const sh = s.shoots.find((x) => x.id === id);
  if (!sh) return;
  axis = norm(axis);
  if (z <= 0) { rotateSubtree(s, id, axis, angle, true); return; }
  if (sh.arc) { turnAlongArc(s, sh, sh.arc.axis, -sh.arc.angle, sh.arc.z); sh.arc = null; }
  sh.arc = { axis, angle, z };
  turnAlongArc(s, sh, axis, angle, z);
}

/** Nasazení drátu a ohyb. Přes bezpečnou mez hrozí prasknutí – prasklá větev odumře. */
function wire(s: State, id: number, axis: Vec3, angle: number, z: number) {
  const sh = s.shoots.find((x) => x.id === id);
  if (!sh || sh.dead || sh.elong) return;
  axis = norm(axis);
  if (rnd(s.seed, id, s.day) < breakRisk(s, sh, angle, z)) {
    rotateSubtree(s, id, axis, angle * 0.5);
    const year = yearOf(s.day);
    const dead = new Set<number>();
    for (const x of s.shoots) {
      if (x.id !== id && !dead.has(x.parent)) continue;
      dead.add(x.id);
      x.dead = true; x.deadYear = year; x.elong = false; x.needleLive = 0; x.buds = []; x.wire = null;
    }
    updateDeath(s);
    return;
  }
  bendShoot(s, id, axis, angle, z);
  // doohnutí už nadrátované větve: tvar se fixuje znovu
  sh.wire = { day: s.day, axis, angle, z, set: sh.wire ? sh.wire.set * 0.5 : 0, area0: sh.wire ? sh.wire.area0 : sh.area };
}

/** Sundání drátu: co dřevo ještě nedrží, to se vrátí zpět. */
function unwire(s: State, id: number) {
  const sh = s.shoots.find((x) => x.id === id);
  if (!sh || !sh.wire) return;
  const w = sh.wire;
  sh.wire = null;
  const back = -w.angle * (1 - w.set);
  if (w.z > 0 && sh.arc) {
    turnAlongArc(s, sh, sh.arc.axis, back, sh.arc.z);
    sh.arc.angle += back;
    if (Math.abs(sh.arc.angle) < 1e-3) sh.arc = null;
  } else rotateSubtree(s, id, w.axis, back);
}

/** Přesazení: nová nádoba dimenzovaná na strom, zakrácení kořenů, natočení a náklon. */
function repot(s: State, a: Extract<Action, { type: 'repot' }>) {
  const prune = Math.min(0.9, Math.max(0, a.prune ?? 0));
  const first = s.day === s.repotDay; // volba nádoby při výsevu nic nestojí
  if (!first && s.stage !== 'seed') s.stress += repotStress(s, prune);
  const spec = potById(a.potId ?? defaultPotId(a.pot));
  s.pot = spec.type;
  s.potId = spec.id;
  s.roots *= 1 - prune;
  s.potCap = potCapFor(spec.id);
  s.repotDay = s.day;
  const rad = Math.PI / 180;
  rotateSubtree(s, -1, [0, 1, 0], (a.yaw ?? 0) * rad);
  // kořeny se otáčejí se stromem; při přesazení je lze rozprostřít rovnoměrně do stran
  const spread = Math.min(1, Math.max(0, a.spread ?? 0));
  const sorted = s.nebari.slice().sort((x, y) => x.az - y.az);
  const meanLen = sorted.reduce((t, r) => t + r.len, 0) / Math.max(1, sorted.length);
  sorted.forEach((r, k) => {
    const even = sorted[0].az + (k / sorted.length) * 6.2832;
    r.az += (even - r.az) * spread;
    r.len += (meanLen - r.len) * spread * 0.6;
    r.az -= (a.yaw ?? 0) * rad; // otočení kolem svislé osy (stejný smysl jako u výhonů)
  });
  rotateSubtree(s, -1, [1, 0, 0], (a.tiltX ?? 0) * rad);
  rotateSubtree(s, -1, [0, 0, 1], (a.tiltZ ?? 0) * rad);
  if (s.stress >= 1 && s.stage === 'growing') {
    const year = yearOf(s.day);
    for (const x of s.shoots) if (!x.dead) { x.dead = true; x.deadYear = year; x.elong = false; x.needleLive = 0; x.buds = []; }
    s.stage = 'dead';
  }
}

export function applyAction(s: State, a: Action) {
  if (a.type === 'cut') cut(s, a.shoot, a.t);
  else if (a.type === 'bud') {
    const sh = s.shoots.find((x) => x.id === a.shoot);
    if (!sh) return;
    sh.buds = sh.buds.filter((b) => b.id !== a.bud);
    updateDeath(s);
  } else if (a.type === 'repot') repot(s, a);
  else if (a.type === 'wire') wire(s, a.shoot, a.axis, a.angle, a.z ?? 0);
  else if (a.type === 'unwire') unwire(s, a.shoot);
}
