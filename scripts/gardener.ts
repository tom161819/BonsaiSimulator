// „Zahradník“: hraje hru přes stejné zásahy jako hráč (řez, pupeny, drát, přesazení) a tvaruje strom do zvoleného stylu.
// Výsledkem je uložená hra (semínko + deník zásahů), kterou jde ve hře otevřít a projít po časové ose.
//   npm run samples   -> přepočítá stromy (src/samples.json) a jejich portréty (src/sampleThumbs.json)
// Uložené hry závisí na parametrech simulace: po každé změně modelu růstu je nutné je přegenerovat.
import { writeFileSync } from 'node:fs';
import { Timeline } from '../src/sim/timeline';
import { YEAR, bendLimit, computeFrames, radiusOf, rootFill, stats } from '../src/sim/util';
import type { ActionInput, Shoot, Vec3 } from '../src/sim/types';

const nrm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface Style {
  id: string; name: string; style: string; about: string; seed: number; years: number;
  potYear: number; pot: string; tiltZ?: number; tiltX?: number; // přesazení do misky (do té doby volná půda)
  sacrificeUntil: number; // rok, kdy se odstraní obětní větev (0 = bez ní)
  finalHeight: number;
  clear: number; // podíl výšky bez větví (holý spodek kmene)
  perWhorl: number; // kolik větví nechat v jednom přeslenu
  droop: number; // cílový sklon větví (složka y; záporná = pod vodorovnou)
  trunkBend: number; // ohyb mladého kmene drátem (rad), střídavě do stran
  trunkBendYears: [number, number];
  leaderTarget?: Vec3; // kam drátem vést vrchol (šikmý styl, kaskáda)
  leaderEarly?: { until: number; target: Vec3 }; // směr vrcholu v prvních letech (kaskáda nejdřív stoupá, pak klesá)
  keepLeader: number; // na kolik cm se zaštipuje svíčka vrcholu, dokud strom roste do výšky
  keepBranch: number; // na kolik cm se zaštipují svíčky větví
  spread: number; // délka spodních větví jako podíl cílové výšky
}

class Gardener {
  tl: Timeline;
  constructor(readonly st: Style) { this.tl = new Timeline(st.seed); }
  get s() { return this.tl.state; }
  go(y: number, doy: number) { this.tl.seek(y * YEAR + doy); }
  act(a: ActionInput) { this.tl.act(a); }
  kids(id: number) { return this.s.shoots.filter((x) => x.parent === id && !x.dead); }
  /** osa kmene od paty k vrcholu */
  trunk(): Shoot[] {
    const out: Shoot[] = [];
    let cur: Shoot | undefined = this.s.shoots[0];
    while (cur && !cur.dead) { out.push(cur); cur = this.kids(cur.id).find((k) => k.isMain && k.attachT > 0.98); }
    return out;
  }
  tipY(sh: Shoot) { const fr = computeFrames(this.s); return fr.tip[fr.index.get(sh.id)! * 3 + 1]; }
  height() { return stats(this.s).height; }

  chop(height: number, label: string) {
    const tr = this.trunk();
    for (let i = 0; i < tr.length - 1; i++) {
      const laterals = this.kids(tr[i].id).filter((k) => !k.isMain && k.attachT > 0.98);
      if (this.tipY(tr[i]) >= height && laterals.length) { this.act({ type: 'cut', shoot: tr[i + 1].id, t: 0, label }); return true; }
    }
    return false;
  }

  /** výhony patřící k větvím, které nasedají na kmen pod danou výškou (budoucí koruna) */
  lowSet(maxY: number): Set<number> {
    const trunkIds = new Set(this.trunk().map((x) => x.id));
    const fr = computeFrames(this.s);
    const set = new Set<number>();
    for (const x of this.s.shoots) {
      if (x.dead) continue;
      if (set.has(x.parent)) set.add(x.id);
      else if (!x.isMain && trunkIds.has(x.parent) && fr.base[fr.index.get(x.id)! * 3 + 1] < maxY) set.add(x.id);
    }
    return set;
  }

  /** Zaštipování s vyvažováním: silný vršek koruny se krátí víc, slabé spodní větve méně. */
  pinch(keepLeader: number, keepBranch: number, skip?: Set<number>) {
    const trunkIds = new Set(this.trunk().map((x) => x.id));
    const fr = computeFrames(this.s);
    const H = Math.max(this.height(), 1);
    for (const sh of this.s.shoots.filter((x) => x.elong && x.kind === 'shoot' && !x.tipCut && !x.dead && !skip?.has(x.id))) {
      const rel = Math.min(1, Math.max(0, fr.base[fr.index.get(sh.id)! * 3 + 1] / H));
      const keep = trunkIds.has(sh.id) ? keepLeader : keepBranch * (1.6 - 1.3 * rel);
      if (sh.targetLen > keep * 1.4) this.act({ type: 'cut', shoot: sh.id, t: Math.max(0.25, keep / sh.targetLen), label: 'Zaštípnuta svíčka' });
    }
  }

  /** Výběr pupenů: v silné horní části koruny zůstanou dva, dole se nechávají všechny. */
  budSelect() {
    const fr = computeFrames(this.s);
    const H = Math.max(this.height(), 1);
    for (const sh of this.s.shoots.filter((x) => !x.dead && x.buds.length > 2)) {
      if (fr.tip[fr.index.get(sh.id)! * 3 + 1] / H < 0.6) continue;
      const lat = sh.buds.filter((b) => !b.isMain).sort((a, b) => Math.abs(a.dir[1]) - Math.abs(b.dir[1])); // nejvodorovnější první
      for (const b of lat.slice(1)) this.act({ type: 'bud', shoot: sh.id, bud: b.id, label: 'Vylomen přebytečný pupen' });
    }
  }

  /** nechá v každém přeslenu kmene jen pár větví, rozložených střídavě kolem kmene; spodek kmene vyčistí */
  selectBranches(clearLow: boolean, skip?: Set<number>) {
    const tr = this.trunk();
    const H = Math.max(this.height(), 1);
    tr.forEach((node, k) => {
      const lat = this.kids(node.id).filter((x) => !x.isMain && !skip?.has(x.id));
      if (!lat.length) return;
      if (clearLow && this.tipY(node) < this.st.clear * Math.min(H, this.st.finalHeight)) {
        for (const b of lat) this.act({ type: 'cut', shoot: b.id, t: 0, label: 'Odstraněna spodní větev' });
        return;
      }
      const want = k * 2.4; // zlatý úhel: větve střídavě vlevo, vpravo, dozadu
      const score = (b: Shoot) => Math.cos(Math.atan2(b.dir[2], b.dir[0]) - want);
      lat.sort((a, b) => score(b) - score(a));
      for (const b of lat.slice(this.st.perWhorl)) this.act({ type: 'cut', shoot: b.id, t: 0, label: 'Odstraněna větev z přeslenu' });
    });
  }

  subtree(id: number): Set<number> {
    const set = new Set<number>([id]);
    for (const x of this.s.shoots) if (set.has(x.parent)) set.add(x.id);
    return set;
  }

  wireTo(sh: Shoot, target: Vec3, z: number, label: string) {
    if (sh.dead || sh.elong || sh.wire || sh.parent < 0) return;
    const t = nrm(target);
    const angle = Math.min(Math.acos(Math.max(-1, Math.min(1, dot(sh.dir, t)))), bendLimit(this.s, sh, z) * 0.92);
    const axis = cross(sh.dir, t);
    if (angle < 0.08 || Math.hypot(...axis) < 1e-4) return;
    this.act({ type: 'wire', shoot: sh.id, axis: nrm(axis), angle, z, label });
  }

  /** větve do vodorovných pater: první úsek větve i její pokračování */
  levelBranches(skip?: Set<number>) {
    const trunkIds = new Set(this.trunk().map((x) => x.id));
    for (const sh of this.s.shoots.filter((x) => !x.dead && !x.elong && !x.wire && x.order >= 1 && radiusOf(x) < 1.2 && !skip?.has(x.id))) {
      const par = this.s.shoots.find((p) => p.id === sh.parent);
      if (!par) continue;
      const primary = trunkIds.has(par.id) && !sh.isMain;
      if (!primary && !(sh.isMain && sh.order === 1)) continue;
      const hz = Math.hypot(sh.dir[0], sh.dir[2]) || 1;
      const y = primary ? this.st.droop : this.st.droop * 0.4;
      if (Math.abs(sh.dir[1] - y) < 0.12) continue;
      this.wireTo(sh, [sh.dir[0] / hz, y, sh.dir[2] / hz], 0.6, 'Větev nadrátována do patra');
    }
  }

  /** nový vrchol po seříznutí je bývalá větev – drátem se vyváže vzhůru (s mírným vybočením kvůli pohybu kmene) */
  uprightTrunk() {
    for (const seg of this.trunk()) {
      if (seg.parent < 0 || seg.dir[1] > 0.8 || radiusOf(seg) > 1.6) continue;
      const hz = Math.hypot(seg.dir[0], seg.dir[2]) || 1;
      this.wireTo(seg, [(seg.dir[0] / hz) * 0.45, 1, (seg.dir[2] / hz) * 0.45], 0.9, 'Nový vrchol vyvázán vzhůru');
    }
  }

  /** zkrácení větví zpět na vnitřní boční výhon: koruna zůstává kompaktní a dole širší než nahoře */
  shortenBranches(skip?: Set<number>) {
    const tr = this.trunk();
    const trunkIds = new Set(tr.map((x) => x.id));
    const H = Math.max(this.height(), 1);
    const fr = computeFrames(this.s);
    for (const br of this.s.shoots.filter((x) => !x.dead && !x.isMain && trunkIds.has(x.parent) && !skip?.has(x.id))) {
      const y0 = fr.base[fr.index.get(br.id)! * 3 + 1];
      const maxLen = Math.max(4, this.st.finalHeight * (this.st.spread - this.st.spread * 0.7 * Math.min(1, y0 / H)));
      // řez vede za nejvzdálenější olistěný boční výhon, který je ještě v dosahu; není-li žádný, za první další
      let cur: Shoot | undefined = br, len = 0, inside: Shoot | null = null, beyond: Shoot | null = null, total = 0;
      while (cur) {
        len += cur.len;
        const next: Shoot | undefined = this.kids(cur.id).find((k) => k.isMain && k.attachT > 0.98);
        const side = this.kids(cur.id).some((k) => !k.isMain && k.needleLive > 0.3 && k.needleCount > 0);
        if (next && side) { if (len <= maxLen) inside = next; else if (!beyond) beyond = next; }
        total = len;
        cur = next;
      }
      const cutAt = inside ?? beyond;
      if (total > maxLen * 1.15 && cutAt) this.act({ type: 'cut', shoot: cutAt.id, t: 0, label: 'Větev zkrácena na vnitřní výhon' });
    }
  }

  unwire() {
    for (const sh of this.s.shoots.filter((x) => x.wire)) {
      if (sh.wire!.set >= 0.9 || sh.area > sh.wire!.area0 * 1.3) this.act({ type: 'unwire', shoot: sh.id, label: 'Sundán drát' });
    }
  }

  run() {
    const st = this.st;
    let sacrifice = -1;
    for (let y = 0; y < st.years; y++) {
      const refine = y >= st.potYear;
      const protect = sacrifice >= 0 && this.s.shoots.some((x) => x.id === sacrifice) ? this.subtree(sacrifice) : undefined;
      // --- předjaří: přesazení, obětní větev, výběr pupenů
      this.go(y, 75);
      if (this.s.stage === 'dead') break;
      if (y === 1) this.act({ type: 'repot', pot: 'ground', potId: 'ground', prune: 0, label: 'Vysazeno do volné půdy' });
      if (y === st.sacrificeUntil && protect) { this.act({ type: 'cut', shoot: sacrifice, t: 0, label: 'Odstraněna obětní větev – kmen pod ní zesílil' }); sacrifice = -1; }
      if (y === st.potYear) this.act({ type: 'repot', pot: 'bonsai', potId: st.pot, prune: 0.45, tiltZ: st.tiltZ ?? 0, tiltX: st.tiltX ?? 0, spread: 1, label: 'Vyzvednuto z půdy a přesazeno do misky' });
      else if (y > st.potYear && rootFill(this.s) > 0.7) this.act({ type: 'repot', pot: this.s.pot, potId: this.s.potId, prune: 0.4, label: 'Přesazeno, kořeny zakráceny' });
      this.unwire();
      // výška: jakmile strom doroste, vylomí se terminální pupen vrcholu a dál rostou jen boční
      if (this.height() >= st.finalHeight * 0.95) {
        const tip = this.trunk().pop();
        const term = tip?.buds.find((b) => b.isMain);
        if (tip && term && tip.buds.length > 1) this.act({ type: 'bud', shoot: tip.id, bud: term.id, label: 'Vylomen terminální pupen vrcholu' });
      }
      if (y >= 5) this.budSelect();
      // --- květen: zaštipování svíček (obětní větev roste volně)
      this.go(y, 138);
      if (y >= 2) this.pinch(this.height() >= st.finalHeight * 0.9 ? 1.5 : st.keepLeader, st.keepBranch, sacrifice >= 0 ? this.subtree(sacrifice) : undefined);
      // --- podzim: výběr větví a drátování
      this.go(y, 320);
      if (y === 3 && st.sacrificeUntil > 0) {
        // obětní větev: nejníže nasazená větev, která se nechá bez zásahu přerůst
        const trunkIds = new Set(this.trunk().map((x) => x.id));
        const low = this.s.shoots.filter((x) => !x.dead && !x.isMain && trunkIds.has(x.parent));
        if (low.length) sacrifice = low[0].id;
      }
      const keepOut = sacrifice >= 0 ? this.subtree(sacrifice) : undefined;
      if (y >= st.trunkBendYears[0] && y <= st.trunkBendYears[1] && st.trunkBend > 0) {
        const tr = this.trunk();
        const seg = tr[tr.length - 1];
        const az = y * 2.2;
        const tb: Vec3 = [Math.sin(st.trunkBend) * Math.cos(az), Math.cos(st.trunkBend), Math.sin(st.trunkBend) * Math.sin(az)];
        for (const sg of tr.slice(-2)) if (sg.parent >= 0) this.wireTo(sg, tb, 0.8, 'Kmen ohnut drátem');
      }
      if (y >= 3) this.selectBranches(refine, keepOut);
      if (st.leaderTarget && y >= 2) {
        const tgt = st.leaderEarly && y <= st.leaderEarly.until ? st.leaderEarly.target : st.leaderTarget;
        for (const seg of this.trunk().slice(-2)) this.wireTo(seg, tgt, 0.8, 'Vrchol veden drátem');
      }
      if (y >= 4) this.shortenBranches(keepOut);
      if (y >= 4) this.levelBranches(keepOut);
      this.unwire();
      if (process.env.DIAG) { const q = stats(this.s); console.log(`  ${y + 1}. rok: ${q.height.toFixed(0)} cm, kmen ${(q.baseDiameter * 10).toFixed(0)} mm, výhonů ${q.shoots}, jehlic ${q.needles}, kořeny ${(rootFill(this.s) * 100).toFixed(0)} %, ${this.s.potId}, P ${this.s.production.toFixed(0)} G ${this.s.budget.toFixed(0)} zásahů ${this.tl.actions.length}`); }
    }
    this.go(st.years - 1, 330);
    for (const sh of this.s.shoots.filter((x) => x.wire)) this.act({ type: 'unwire', shoot: sh.id, label: 'Sundán drát' });
    this.go(st.years, 190);
    return this;
  }
}

export const STYLES: Style[] = [
  {
    id: 'moyogi', name: 'Moyogi', style: 'volně vzpřímený', seed: 11, years: 22,
    about: 'Kmen s měkkými ohyby a vrcholem nad patou. Nejčastější styl borovic na výstavách; kmen zesílil obětní větví.',
    potYear: 11, pot: 'b6', sacrificeUntil: 10, finalHeight: 50,
    clear: 0.22, perWhorl: 2, droop: -0.1, trunkBend: 0.7, trunkBendYears: [1, 7], keepLeader: 6, keepBranch: 4, spread: 0.4,
  },
  {
    id: 'chokkan', name: 'Chokkan', style: 'přísně vzpřímený', seed: 23, years: 22,
    about: 'Rovný kmen zužující se k vrcholu a vodorovná patra větví. Styl, který nic neskryje – stojí na pravidelnosti.',
    potYear: 11, pot: 'b12', sacrificeUntil: 9, finalHeight: 52,
    clear: 0.25, perWhorl: 2, droop: -0.05, trunkBend: 0, trunkBendYears: [0, 0], keepLeader: 7, keepBranch: 4, spread: 0.42,
  },
  {
    id: 'shakan', name: 'Shakan', style: 'šikmý', seed: 37, years: 22,
    about: 'Kmen nakloněný do strany, jako strom rostoucí v trvalém větru. Náklon vznikl přesazením nakřivo a vedením vrcholu drátem.',
    potYear: 10, pot: 'b3', tiltZ: -28, sacrificeUntil: 9, finalHeight: 45, leaderTarget: [0.5, 0.86, 0],
    clear: 0.25, perWhorl: 2, droop: -0.08, trunkBend: 0, trunkBendYears: [0, 0], keepLeader: 6, keepBranch: 4, spread: 0.45,
  },
  {
    id: 'bunjingi', name: 'Bunjingi', style: 'literátský', seed: 51, years: 24,
    about: 'Vysoký štíhlý kmen s výrazným pohybem a jen několika větvemi u vrcholu. Pro borovici lesní typický styl evropských sbírek.',
    potYear: 12, pot: 'b3', sacrificeUntil: 0, finalHeight: 68,
    clear: 0.62, perWhorl: 1, droop: -0.3, trunkBend: 0.8, trunkBendYears: [1, 11], keepLeader: 11, keepBranch: 3.5, spread: 0.3,
  },
  {
    id: 'fukinagashi', name: 'Fukinagashi', style: 've větru', seed: 64, years: 22,
    about: 'Silně nakloněný kmen s korunou staženou na jednu stranu, jako strom na návětrném hřebeni. Vrchol byl každý rok veden drátem po větru.',
    potYear: 10, pot: 'b12', tiltZ: -20, sacrificeUntil: 8, finalHeight: 40, leaderTarget: [0.85, -0.5, 0.15], leaderEarly: { until: 4, target: [0.55, 0.83, 0] },
    clear: 0.12, perWhorl: 2, droop: -0.1, trunkBend: 0, trunkBendYears: [0, 0], keepLeader: 8, keepBranch: 4, spread: 0.45,
  },
];

if (process.argv[1]?.endsWith('gardener.ts')) {
  const only = process.argv[2];
  const out = [];
  for (const st of STYLES.filter((x) => !only || x.id === only)) {
    const t0 = Date.now();
    const g = new Gardener(st).run();
    const s = stats(g.s);
    console.log(`${st.id}: stav ${g.s.stage}, výška ${s.height.toFixed(0)} cm, kmen ${(s.baseDiameter * 10).toFixed(0)} mm, výhonů ${s.shoots}, jehlic ${s.needles}, zásahů ${g.tl.actions.length}, ${Date.now() - t0} ms`);
    out.push({ id: st.id, name: st.name, style: st.style, about: st.about, seed: st.seed, day: g.tl.day, height: Math.round(s.height * 10) / 10, trunk: Math.round(s.baseDiameter * 10), actions: g.tl.actions });
  }
  writeFileSync(process.argv[3] || 'src/samples.json', JSON.stringify(out));
}
