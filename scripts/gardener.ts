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
  rules?: boolean; // stavět podle pravidel bonsajové estetiky (plán kmene, větve na vnějších stranách ohybů…)
  plantTilt?: number; // náklon při výsadbě do půdy – kmen nemá vycházet ze země kolmo
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
  pinch(keepLeader: number, keepBranch: number, skip?: Set<number>, leaderOnly = false) {
    const trunkIds = new Set(this.trunk().map((x) => x.id));
    const fr = computeFrames(this.s);
    const H = Math.max(this.height(), 1);
    for (const sh of this.s.shoots.filter((x) => x.elong && x.kind === 'shoot' && !x.tipCut && !x.dead && !skip?.has(x.id))) {
      const rel = Math.min(1, Math.max(0, fr.base[fr.index.get(sh.id)! * 3 + 1] / H));
      if (leaderOnly && !trunkIds.has(sh.id)) continue;
      const keep = trunkIds.has(sh.id) ? keepLeader : keepBranch * (this.st.rules ? 2.4 - 2.2 * rel : 1.6 - 1.3 * rel);
      if (sh.targetLen > keep * 1.4) this.act({ type: 'cut', shoot: sh.id, t: Math.max(0.25, keep / sh.targetLen), label: 'Zaštípnuta svíčka' });
    }
  }

  /** Výběr pupenů: v silné horní části koruny zůstanou dva, dole se nechávají všechny. */
  budSelect() {
    const fr = computeFrames(this.s);
    const H = Math.max(this.height(), 1);
    for (const sh of this.s.shoots.filter((x) => !x.dead && x.buds.length > 2)) {
      if (fr.tip[fr.index.get(sh.id)! * 3 + 1] / H < (this.st.rules ? 0.72 : 0.6)) continue;
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

  // ---------------------------------------------------------------- stavba podle pravidel
  // Pohled zepředu: osa X doprava, Z k divákovi. Kmen se vlní vlevo–vpravo–vlevo a vrchol končí nad patou,
  // lehce nakloněný k divákovi.
  trunkByRules() {
    const tr = this.trunk();
    const fr = computeFrames(this.s);
    const Hf = this.st.finalHeight;
    for (const seg of tr.slice(-2)) {
      if (seg.parent < 0 || seg.wire || seg.elong) continue;
      const i = fr.index.get(seg.id)!;
      const bx = fr.base[i * 3], by = fr.base[i * 3 + 1], bz = fr.base[i * 3 + 2];
      const f = by / Hf;
      let target: Vec3;
      if (f < 0.28) target = [-0.6, 0.8, 0.1];
      else if (f < 0.52) target = [0.62, 0.78, -0.12];
      else if (f < 0.74) target = [-0.5, 0.86, 0.08];
      else target = [0 - bx, Math.max(4, Hf - by), 3 - bz]; // vrchol míří nad patu kmene a mírně k divákovi
      this.wireTo(seg, target, 0.85, 'Kmen veden drátem podle plánu');
    }
  }

  /** Výběr větví podle pravidel: první větev ve třetině výšky, v každém místě jen jedna, na vnější straně
   *  ohybu, střídavě vlevo–vpravo–dozadu, dole žádná k divákovi, rozestupy se k vrcholu zkracují. */
  branchesByRules(skip?: Set<number>) {
    const tr = this.trunk();
    const fr = computeFrames(this.s);
    const Hf = this.st.finalHeight;
    const hz = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
    let lastY = -99, lastDir: Vec3 | null = null;
    for (let k = 0; k < tr.length; k++) {
      const node = tr[k];
      const lat = this.kids(node.id).filter((x) => !x.isMain && !skip?.has(x.id));
      if (!lat.length) continue;
      const y = fr.tip[fr.index.get(node.id)! * 3 + 1];
      const f = y / Hf;
      const drop = (list: Shoot[], label: string) => { for (const b of list) this.act({ type: 'cut', shoot: b.id, t: 0, label }); };
      if (f < this.st.clear) { drop(lat, 'Odstraněna větev pod první třetinou kmene'); continue; }
      // první větev ve třetině výšky, každá další o třetinu zbývající vzdálenosti k vrcholu výš
      const gap = lastY < 0 ? 0 : (Hf - lastY) / 3;
      if (f < 0.85 && y - lastY < gap) { drop(lat, 'Odstraněna větev příliš blízko nižší větve'); continue; }
      // vnější strana ohybu: směr, od kterého se kmen v tomto místě odklání
      const next = tr[k + 1];
      let out: Vec3 | null = null;
      if (next) { const o: Vec3 = [node.dir[0] - next.dir[0], 0, node.dir[2] - next.dir[2]]; if (Math.hypot(o[0], o[2]) > 0.08) out = hz(o); }
      const score = (b: Shoot) => {
        const d = hz(b.dir);
        let sc = out ? 1.5 * (d[0] * out[0] + d[2] * out[2]) : 0;
        if (f < 0.66) sc -= 1.2 * Math.max(0, d[2]); // dole žádná větev přímo k divákovi
        if (lastDir) sc -= 1.2 * Math.max(0, d[0] * lastDir[0] + d[2] * lastDir[2]); // ne na stejnou stranu jako předchozí
        return sc;
      };
      lat.sort((a, b) => score(b) - score(a));
      const keep = f >= 0.85 ? 2 : 1;
      drop(lat.slice(keep), 'Odstraněna větev z přeslenu');
      lastY = y; lastDir = hz(lat[0].dir);
    }
  }

  /** Vyrovnání síly: borovice žene do vrcholu. Kde je výhonů příliš (hlavně nahoře), nejsilnější se
   *  vystřihnou, aby energie zůstala i spodním větvím – jinak by postupně odumřely. */
  thin(skip?: Set<number>) {
    const trunkIds = new Set(this.trunk().map((x) => x.id));
    const fr = computeFrames(this.s);
    const Hf = this.st.finalHeight;
    const byId = new Map(this.s.shoots.map((x) => [x.id, x]));
    const hasKid = new Set(this.s.shoots.filter((x) => !x.dead).map((x) => x.parent));
    const units = new Map<number, Shoot[]>(); // větev na kmeni (nebo -1 = vrchol) -> její koncové výhony
    for (const tip of this.s.shoots) {
      if (tip.dead || hasKid.has(tip.id) || trunkIds.has(tip.id) || skip?.has(tip.id)) continue;
      let cur: Shoot | undefined = tip, unit = -1;
      while (cur && !trunkIds.has(cur.id)) { unit = cur.id; cur = byId.get(cur.parent); }
      if (!units.has(unit)) units.set(unit, []);
      units.get(unit)!.push(tip);
    }
    for (const [unit, tips] of units) {
      const y = fr.base[fr.index.get(unit)! * 3 + 1];
      const rel = Math.min(1, Math.max(0, y / Hf));
      const cap = Math.round(44 - 30 * rel); // dole smí být větev bohatá, nahoře jen pár výhonů
      if (tips.length <= cap) continue;
      tips.sort((a, b) => b.len - a.len);
      let n = tips.length;
      for (const t of tips) {
        if (n <= cap) break;
        const sib = this.kids(t.parent).length;
        if (sib < 2) continue; // poslední výhon na místě se nechává
        this.act({ type: 'cut', shoot: t.id, t: 0, label: 'Vystřižen silný výhon – vyrovnání síly' });
        n--;
      }
    }
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
      const rel = Math.min(1, Math.max(0, sh.dir[1] > -2 ? computeFrames(this.s).base[computeFrames(this.s).index.get(sh.id)! * 3 + 1] / this.st.finalHeight : 0));
      const droop = this.st.rules ? this.st.droop * (1.4 - 0.9 * rel) : this.st.droop; // dole větve klesají víc (dojem stáří)
      const y = primary ? droop : droop * 0.4;
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
      // Řez vede za nejvzdálenější boční výhon, který je ještě v dosahu; není-li žádný, za první další.
      // Po řezu převezme osu boční výhon, proto se postup opakuje, dokud větev nesedí do siluety.
      for (let pass = 0; pass < 6; pass++) {
        let cur: Shoot | undefined = this.s.shoots.find((x) => x.id === br.id), len = 0, inside: Shoot | null = null, beyond: Shoot | null = null, total = 0;
        while (cur) {
          len += cur.len;
          const next: Shoot | undefined = this.kids(cur.id).find((k) => k.isMain && k.attachT > 0.98);
          const side = this.kids(cur.id).some((k) => !k.isMain);
          if (next && side) { if (len <= maxLen) inside = next; else if (!beyond) beyond = next; }
          total = len;
          cur = next;
        }
        const cutAt = inside ?? beyond;
        if (total <= maxLen * 1.15 || !cutAt) break;
        this.act({ type: 'cut', shoot: cutAt.id, t: 0, label: 'Větev zkrácena na vnitřní výhon' });
      }
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
      if (y === 1) this.act({ type: 'repot', pot: 'ground', potId: 'ground', prune: 0, tiltZ: st.plantTilt ?? 0, label: st.plantTilt ? 'Vysazeno do volné půdy šikmo' : 'Vysazeno do volné půdy' });
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
      // v půdě se strom brzdí jen mírně, aby sílil; jemné zaštipování začíná až v misce
      const young = st.rules && !refine;
      if (y >= 2) this.pinch(this.height() >= st.finalHeight * 0.9 ? (st.rules ? 1 : 1.5) : st.keepLeader, st.keepBranch * (young ? 1.7 : 1), sacrifice >= 0 ? this.subtree(sacrifice) : undefined, young && y < 4);
      // --- podzim: výběr větví a drátování
      this.go(y, 320);
      if (y === 3 && st.sacrificeUntil > 0) {
        // obětní větev: nejníže nasazená větev, která se nechá bez zásahu přerůst
        const trunkIds = new Set(this.trunk().map((x) => x.id));
        const low = this.s.shoots.filter((x) => !x.dead && !x.isMain && trunkIds.has(x.parent));
        if (low.length) sacrifice = low[0].id;
      }
      const keepOut = sacrifice >= 0 ? this.subtree(sacrifice) : undefined;
      if (st.rules && y >= 1) this.trunkByRules();
      if (!st.rules && y >= st.trunkBendYears[0] && y <= st.trunkBendYears[1] && st.trunkBend > 0) {
        const tr = this.trunk();
        const seg = tr[tr.length - 1];
        const az = y * 2.2;
        const tb: Vec3 = [Math.sin(st.trunkBend) * Math.cos(az), Math.cos(st.trunkBend), Math.sin(st.trunkBend) * Math.sin(az)];
        for (const sg of tr.slice(-2)) if (sg.parent >= 0) this.wireTo(sg, tb, 0.8, 'Kmen ohnut drátem');
      }
      if (y >= 3) { if (st.rules) this.branchesByRules(keepOut); else this.selectBranches(refine, keepOut); }
      if (st.leaderTarget && y >= 2) {
        const tgt = st.leaderEarly && y <= st.leaderEarly.until ? st.leaderEarly.target : st.leaderTarget;
        for (const seg of this.trunk().slice(-2)) this.wireTo(seg, tgt, 0.8, 'Vrchol veden drátem');
      }
      if (st.rules && y >= 7) this.thin(keepOut);
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
    id: 'pravidla', name: 'Moyogi podle pravidel', style: 'volně vzpřímený', seed: 11, years: 24, rules: true, plantTilt: 22,
    about: 'Stavěno podle klasických pravidel: kmen se vlní a zužuje, první větev je ve třetině výšky, větve vyrůstají z vnějších stran ohybů a střídají strany, vrchol stojí nad patou.',
    potYear: 12, pot: 'b25', sacrificeUntil: 11, finalHeight: 42,
    clear: 0.3, perWhorl: 1, droop: -0.22, trunkBend: 0, trunkBendYears: [0, 0], keepLeader: 6, keepBranch: 3.2, spread: 0.55,
  },
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
    out.push({ id: st.id, name: st.name, style: st.style, about: st.about, seed: st.seed, rules: g.tl.rules, day: g.tl.day, height: Math.round(s.height * 10) / 10, trunk: Math.round(s.baseDiameter * 10), actions: g.tl.actions });
  }
  writeFileSync(process.argv[3] || 'src/samples.json', JSON.stringify(out));
}
