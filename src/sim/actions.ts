// Zásahy pěstitele. Každý zásah je malý záznam {den, typ, cíl}; strom = f(semínko, seznam zásahů, datum).

import type { Action, Shoot, State } from './types';
import { P } from './params';
import { updateDeath } from './growth';

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
    sh.targetLen *= t;
    sh.len *= t;
    for (const c of s.shoots) if (c.parent === id) c.attachT /= t;
    for (const b of sh.buds) b.t /= t;
    sh.tipCut = true;
    sh.stimulus += 1;
  }
  updateDeath(s);
}

export function applyAction(s: State, a: Action) {
  if (a.type === 'cut') cut(s, a.shoot, a.t);
  else if (a.type === 'bud') {
    const sh = s.shoots.find((x) => x.id === a.shoot);
    if (!sh) return;
    sh.buds = sh.buds.filter((b) => b.id !== a.bud);
    updateDeath(s);
  } else if (a.type === 'repot') s.pot = a.pot;
}
