// Zásahy pěstitele. Každý zásah je malý záznam {den, typ, cíl}; strom = f(semínko, seznam zásahů, datum).

import type { Action, Shoot, State, Vec3 } from './types';
import { P, defaultPotId, potById } from './params';
import { updateDeath } from './growth';
import { MOSS_FULL_DAYS, breakRisk, clamp, heldArc, doyOf, ownFoliage, norm, potCapFor, spreadNebari, repotStress, rnd, rotate, tilt as tiltDir, yearOf } from './util';
import { speciesOf } from './species';

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
    if (sh.wire?.from) sh.wire.from.axis = norm(rotate(sh.wire.from.axis, axis, angle));
  }
}

/** Náhrada vrcholu: když osa přijde o své pokračování, převezme ji nejsilnější živá větev na tomtéž vrcholu.
 *  Stane se pokračováním osy (o řád níž i s celým svým větvením), takže se začne napřimovat jako vrchol. */
function promoteSuccessor(s: State, parentId: number) {
  if (s.rules < 2) return; // v původních pravidlech vrchol nikdo nepřevzal
  const parent = s.shoots.find((x) => x.id === parentId);
  const kids = s.shoots.filter((x) => x.parent === parentId && !x.dead);
  let cand = kids.filter((x) => x.attachT > 0.98);
  if (cand.some((x) => x.isMain) || kids.some((x) => x.isMain)) return;
  // v3: zbyl-li jen pahýl bez jehlic a pupenů, převezme osu i větev nasazená níž na něm
  if (!cand.length && s.rules >= 3 && parent && !parent.buds.length && !(parent.needleCount > 0 && parent.needleLive > 0.3)) cand = kids;
  if (!cand.length) return;
  const best = cand.reduce((a, b) => (b.area * (1.2 + b.dir[1]) > a.area * (1.2 + a.dir[1]) ? b : a));
  best.isMain = true;
  const sub = new Set<number>();
  for (const x of s.shoots) {
    if (x.id !== best.id && !sub.has(x.parent)) continue;
    sub.add(x.id);
    x.order = Math.max(0, x.order - 1);
    for (const b of x.buds) b.order = Math.max(0, b.order - 1);
  }
  // v3: nový vrchol kmene se bude napřimovat i ve stávajícím dřevě (celá jeho osa)
  if (s.rules >= 3 && best.order === 0) {
    let cur: Shoot | undefined = best;
    while (cur) { cur.heir = true; const id: number = cur.id; cur = s.shoots.find((x) => x.parent === id && x.isMain && !x.dead); }
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
    if (sh.isMain) promoteSuccessor(s, sh.parent);
  } else {
    t = Math.max(t, 0.02);
    const gone = new Set<number>();
    for (const c of s.shoots) if (c.parent === id && c.attachT > t) gone.add(c.id);
    removeSubtrees(s, gone);
    sh.buds = sh.buds.filter((b) => b.t <= t);
    const sp = speciesOf(s);
    const removed = sh.len * (1 - t);
    if (sh.kind === 'hypocotyl') sh.needleCount = 0; // dělohy sedí na vrcholu
    else if (sp.kind === 'leafy') {
      sh.needleCount = Math.round(sh.needleCount * t);
      // ochotně obrážející druhy mají spící pupeny po celém dřevě – na pahýlu vždy aspoň jeden zůstane
      if (sh.dormant !== undefined) sh.dormant = Math.max(sp.epicormic >= 0.5 ? 1 : 0, Math.round(sh.dormant * t));
      const inLeaf = s.gdd >= sp.flushGdd && doyOf(s.day) < 230;
      // bříza: řezaná větvička často zaschne, mimo dobu olistění skoro jistě
      if (sp.dieback > 0 && yearOf(s.day) > sh.bornYear && rnd(s.seed, id, s.day) < sp.dieback * (inLeaf ? 1 : 3)) { sh.dormant = 0; sh.needleCount = 0; }
      // druhý růst: po zaštípnutí v době růstu vyraší nejvyšší zbylé pupeny ještě téhož léta
      else if (sp.reflush > 0 && inLeaf && s.gdd < 1150 && (sh.needleCount > 0 || (sh.dormant ?? 0) > 0) && rnd(s.seed, id, s.day + 7) < sp.reflush + 0.3) {
        const len = Math.min(8, Math.max(0.6, removed * sp.reflush * 0.6));
        const nb = len > 2.5 && sh.needleCount >= 2 ? 2 : 1;
        for (let j = 0; j < nb; j++) {
          const side = tiltDir(sh.dir, sp.branchAngle * 0.8, j * Math.PI + id);
          sh.buds.push({ id: s.nextId++, kind: 'pinch', t: j === 0 ? 1 : 0.8, dir: j === 0 && nb === 1 ? sh.dir : side, len: len / nb, order: j === 0 ? sh.order : sh.order + 1, isMain: j === 0, flushDay: s.day + 18 + j * 3 });
        }
        s.pendingFlush = (s.pendingFlush ?? 0) + nb;
      }
    } else {
      const bare = sh.kind === 'shoot' && !sh.split ? P.bareBase : 0;
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
    sh.cutId = s.nextId;
    sh.stimulus += 1;
  }
  updateDeath(s);
  // pahýl bez jehlic odumřel – osu převezme větev pod ním
  if (sh.dead && sh.isMain && sh.parent >= 0 && s.shoots.includes(sh)) promoteSuccessor(s, sh.parent);
  // v3: zkrácený výhon bez jehlic už vrchol nevytvoří – osu převezme větev, která na něm zbyla
  else if (s.rules >= 3 && !sh.dead && sh.tipCut && s.shoots.includes(sh)) promoteSuccessor(s, sh.id);
}

/** Stočí vše, co na výhonu roste, o podíl úhlu podle místa nasazení na oblouku. */
function turnAlongArc(s: State, sh: Shoot, axis: Vec3, angle: number, z: number) {
  const f = (t: number) => angle * Math.min(1, t / Math.max(z, 1e-3));
  for (const c of s.shoots.filter((x) => x.parent === sh.id)) rotateSubtree(s, c.id, axis, f(c.attachT));
  for (const b of sh.buds) b.dir = norm(rotate(b.dir, axis, f(b.t)));
}

/** Rozdělí vyzrálý výhon v místě t (0..1) na dva navazující úseky a vrátí ten vnější. Tvar stromu se nezmění;
 *  díky tomu jde větev ohnout v libovolném místě, ne jen v nasazení ročního přírůstku. Když dělit nejde
 *  (měkká svíčka, děložní část, místo uvnitř už ohnutého oblouku nebo moc blízko konci), vrátí null. */
export function splitShoot(s: State, id: number, t: number): Shoot | null {
  const i = s.shoots.findIndex((x) => x.id === id);
  const sh = s.shoots[i];
  if (!sh || sh.dead || sh.elong || sh.kind !== 'shoot' || !(t > 0.04 && t < 0.96)) return null;
  if (sh.arc && t < sh.arc.z - 1e-6) return null;
  const sp = speciesOf(s), per = sp.kind === 'leafy' && sp.phyllotaxis === 'opposite' ? 2 : 1;
  const nB = Math.round((sh.needleCount * (1 - t)) / per) * per;
  const dB = sh.dormant === undefined ? undefined : Math.round(sh.dormant * (1 - t));
  const out: Shoot = {
    ...sh, id: s.nextId++, parent: sh.id, attachT: 1, isMain: true, split: true,
    dir: sh.arc ? norm(rotate(sh.dir, sh.arc.axis, sh.arc.angle)) : [...sh.dir] as Vec3,
    len: sh.len * (1 - t), targetLen: sh.len * (1 - t), needleCount: nB, dormant: dB,
    buds: sh.buds.filter((b) => b.t > t).map((b) => ({ ...b, t: (b.t - t) / (1 - t) })),
    wire: null, arc: null, stimulus: 0, male: false,
  };
  for (const c of s.shoots) {
    if (c.parent !== sh.id) continue;
    if (c.attachT > t) { c.parent = out.id; c.attachT = (c.attachT - t) / (1 - t); } else c.attachT = c.attachT / t;
  }
  sh.buds = sh.buds.filter((b) => b.t <= t).map((b) => ({ ...b, t: b.t / t }));
  sh.len *= t; sh.targetLen = sh.len; sh.tipCut = false; sh.cone = false; sh.cutId = undefined;
  sh.needleCount -= nB;
  if (dB !== undefined) sh.dormant = (sh.dormant ?? 0) - dB;
  // oblouk i drát vnitřní části se vztahují k její délce
  if (sh.arc) sh.arc.z = Math.min(1, sh.arc.z / t);
  if (sh.wire && sh.wire.z > 0) { sh.wire.z = Math.min(1, sh.wire.z / t); if (sh.wire.from) sh.wire.from.z = Math.min(1, sh.wire.from.z / t); }
  s.shoots.splice(i + 1, 0, out);
  return out;
}

/** Ohyb v daném místě výhonu: at > 0 výhon nejdřív rozdělí a ohne jeho vnější část. Vrací id ohnutého úseku.
 *  Používá ho zásah drátem i náhled při tažení. */
export function bendAt(s: State, id: number, at: number, axis: Vec3, angle: number, z: number): number {
  const out = at > 0 ? splitShoot(s, id, at) : null;
  bendShoot(s, out ? out.id : id, axis, angle, z);
  return out ? out.id : id;
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
  if (rnd(s.seed, id, s.day) < breakRisk(s, sh, angle, z, axis)) {
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
  if (s.rules >= 8 && z > 0) {
    // v8: co dřevo drží z dřívějška, je výchozí tvar; nový drát fixuje jen změnu proti němu
    const from = heldArc(sh);
    bendShoot(s, id, axis, angle, z);
    sh.wire = { day: s.day, axis, angle, z, set: 0, area0: sh.wire ? sh.wire.area0 : sh.area, from };
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
  if (s.rules >= 8 && w.z > 0 && sh.arc) {
    // v8: větev se vrátí k tomu, co dřevo drží (dřívější zarostlý oblouk + zdřevnatělý podíl nového ohybu)
    const h = heldArc(sh);
    sh.wire = null;
    turnAlongArc(s, sh, sh.arc.axis, -sh.arc.angle, sh.arc.z);
    sh.arc = h && Math.abs(h.angle) >= 1e-3 ? h : null;
    if (sh.arc) turnAlongArc(s, sh, sh.arc.axis, sh.arc.angle, sh.arc.z);
    return;
  }
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
  if (!first && s.stage !== 'seed') s.stress += repotStress(s, prune) * (speciesOf(s).kind === 'leafy' ? speciesOf(s).repotStress : 1);
  const spec = potById(a.potId ?? defaultPotId(a.pot));
  s.pot = spec.type;
  s.potId = spec.id;
  s.roots *= 1 - prune;
  s.potCap = potCapFor(spec.id);
  s.repotDay = s.day;
  if (s.rules >= 9) {
    // v9: čerstvý substrát chřadnutí zastaví, pokud se do něj kořeny vejdou (pod 120 %). Když je nádoba
    // i po přesazení přeplněná, strom dostane jen odklad: počítadlo se vrátí nejvýš na konec doby stagnace.
    const f = spec.type === 'ground' ? 0 : s.roots / s.potCap;
    s.bound = f < P.boundFrom9 ? 0 : Math.min(s.bound ?? 0, P.boundGrace9);
  }
  const rad = Math.PI / 180;
  rotateSubtree(s, -1, [0, 1, 0], (a.yaw ?? 0) * rad);
  // kořeny se otáčejí se stromem; při přesazení je lze rozprostřít rovnoměrně do stran
  s.nebari = spreadNebari(s.nebari, a.spread ?? 0);
  for (const r of s.nebari) r.az -= (a.yaw ?? 0) * rad; // otočení kolem svislé osy (stejný smysl jako u výhonů)
  // mech: po přesazení je substrát holý, pokud ho pěstitel nevrátí nebo nepoloží nový
  s.mossAge = a.moss === 'keep' ? s.mossAge ?? 0 : a.moss === 'full' ? MOSS_FULL_DAYS : 0;
  if (a.mound !== undefined) s.mound = Math.max(0, Math.min(1, a.mound));
  if (a.glaze !== undefined) s.glaze = a.glaze;
  if (a.offX !== undefined || a.offZ !== undefined) s.potOffset = [Math.max(-0.85, Math.min(0.85, a.offX ?? 0)), Math.max(-0.85, Math.min(0.85, a.offZ ?? 0))];
  rotateSubtree(s, -1, [1, 0, 0], (a.tiltX ?? 0) * rad);
  rotateSubtree(s, -1, [0, 0, 1], (a.tiltZ ?? 0) * rad);
  if (s.stress >= 1 && s.stage === 'growing') {
    const year = yearOf(s.day);
    for (const x of s.shoots) if (!x.dead) { x.dead = true; x.deadYear = year; x.elong = false; x.needleLive = 0; x.buds = []; }
    s.stage = 'dead';
  }
}

/** v10, nástroj Listy: odstranění listů z výhonů (keep = podíl listů, který na každém zůstane).
 *  V době růstu vyraší úžlabní pupeny znovu – krátké výhonky s menšími listy, tak vzniká jemné větvení.
 *  Odlistění strom oslabí úměrně tomu, o kolik olistění přišel; druhy, které znovu raší neochotně, víc. */
function defoliate(s: State, ids: number[], keep: number) {
  const sp = speciesOf(s);
  if (sp.kind !== 'leafy' || s.rules < 10) return;
  const set = new Set(ids), year = yearOf(s.day), per = sp.phyllotaxis === 'opposite' ? 2 : 1;
  const inLeaf = s.gdd >= sp.flushGdd && doyOf(s.day) < 230;
  let before = 0, gone = 0;
  for (const sh of s.shoots) before += ownFoliage(s, sh);
  for (const sh of s.shoots) {
    if (!set.has(sh.id) || sh.dead || sh.needleCount <= 0 || sh.needleLive <= 0.02 || sh.kind === 'hypocotyl') continue;
    const n = sh.needleCount, left = Math.ceil(n * clamp(keep, 0, 1) - 1e-9), removed = n - left;
    if (removed <= 0) continue;
    gone += (ownFoliage(s, sh) * removed) / n;
    sh.needleCount = left;
    // letošní výhon má pupeny v úžlabí listů, i když je model zakládá až v létě – bez listů nesmí odumřít
    if (sh.bornYear === year && sh.dormant === undefined) sh.dormant = Math.max(1, Math.round(sh.len / sp.internode)) * per;
    const canFlush = sp.reflush > 0 && inLeaf && s.gdd < 1150 && !sh.elong && (sh.dormant ?? 0) > 0;
    if (canFlush && rnd(s.seed, sh.id, s.day + 11) < (sp.reflush + 0.3) * (1 - keep * 0.6)) {
      const nb = Math.min(sh.dormant ?? 0, keep === 0 && removed >= 2 * per ? 2 : 1);
      for (let j = 0; j < nb; j++) {
        sh.buds.push({ id: s.nextId++, kind: 'pinch', t: clamp(0.9 - j * 0.3, 0.2, 0.95), dir: tiltDir(sh.dir, sp.branchAngle * 0.8, j * Math.PI + sh.id),
          len: clamp(0.25 * sh.len, 0.8, 3), order: sh.order + 1, isMain: false, flushDay: s.day + 18 + j * 3 });
      }
      sh.dormant = Math.max(0, (sh.dormant ?? 0) - nb);
      s.pendingFlush = (s.pendingFlush ?? 0) + nb;
    }
  }
  if (before > 0) s.stress += P.defolStress10 * (gone / before) * (1.3 - sp.reflush);
}

/** Suché větve, které jdou odstranit: odumřelé výhony, na nichž už nic živého neroste (kmen zůstává). */
export function deadwood(s: State): Set<number> {
  const live = new Set<number>();
  const idx = new Map<number, Shoot>(s.shoots.map((x) => [x.id, x]));
  for (const sh of s.shoots) if (!sh.dead) for (let p: Shoot | undefined = sh; p && !live.has(p.id); p = idx.get(p.parent)) live.add(p.id);
  return new Set(s.shoots.filter((x) => x.dead && x.parent >= 0 && !live.has(x.id)).map((x) => x.id));
}

/** Celá větev k nejbližšímu rozvětvení: od zvoleného výhonu dolů po ose, dokud na ní neroste nic dalšího.
 *  Vrací výhon, který se má odstranit u báze (u větve bez rozvětvení ten, který sedí na kmeni). */
export function wholeBranch(s: State, id: number): Shoot | null {
  const by = new Map<number, Shoot>(s.shoots.map((x) => [x.id, x]));
  let cur = by.get(id);
  if (!cur || cur.parent < 0) return null;
  const trunk = (x: Shoot) => x.order === 0 && x.isMain;
  for (;;) {
    const par = by.get(cur.parent);
    if (!par || par.parent < 0 || cur.attachT <= 0.98) break;
    if (trunk(par) && !trunk(cur)) break;
    if (s.shoots.some((x) => x.parent === par.id && x.id !== cur!.id && !x.dead) || par.buds.length) break;
    cur = par;
  }
  return cur;
}

export function applyAction(s: State, a: Action) {
  if (a.type === 'cut') cut(s, a.shoot, a.t);
  else if (a.type === 'bud') {
    const sh = s.shoots.find((x) => x.id === a.shoot);
    if (!sh) return;
    sh.buds = sh.buds.filter((b) => b.id !== a.bud);
    updateDeath(s);
  } else if (a.type === 'repot') repot(s, a);
  else if (a.type === 'wire') wire(s, (a.at ? splitShoot(s, a.shoot, a.at)?.id : undefined) ?? a.shoot, a.axis, a.angle, a.z ?? 0);
  else if (a.type === 'unwire') unwire(s, a.shoot);
  else if (a.type === 'cutMany') for (const c of a.cuts) cut(s, c.shoot, c.t);
  else if (a.type === 'moss') s.mossAge = 0;
  else if (a.type === 'leaf') defoliate(s, a.shoots, a.keep);
  else if (a.type === 'cleanDead') removeSubtrees(s, deadwood(s));
  else if (a.type === 'unwireAll') for (const id of s.shoots.filter((x) => x.wire && (a.only !== 'biting' || x.scar)).map((x) => x.id)) unwire(s, id);
}
