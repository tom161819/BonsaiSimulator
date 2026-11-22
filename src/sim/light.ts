import type { State } from './types';
import { P } from './params';
import { Frames, clamp, ownFoliage } from './util';

/** Oslunění výhonů: voxelová stínová mřížka (Palubicki et al. 2009).
 *  Každý olistěný úsek vrhá stín do jehlanu voxelů pod sebou; světlo = 1 − stín.
 *  Borovice lesní je silně světlomilná – zastíněné vnitřní a spodní výhony slábnou a odumírají. */
export function computeLight(s: State, fr: Frames): void {
  const n = s.shoots.length;
  let H = 1;
  for (let i = 0; i < n; i++) if (!s.shoots[i].dead) H = Math.max(H, fr.tip[i * 3 + 1]);
  const v = Math.max(P.voxelMin, H / P.voxelPerHeight);
  const shade = new Map<number, number>();
  const key = (i: number, j: number, k: number) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  const { base, tip } = fr;

  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    const f = ownFoliage(s, sh);
    if (f <= 0) continue;
    const m = Math.max(1, Math.ceil(sh.len / v));
    const a0 = (P.shadeK * (f / m)) / (v * v);
    for (let q = 0; q < m; q++) {
      const t = (q + 0.5) / m;
      const ci = Math.floor((base[i * 3] + (tip[i * 3] - base[i * 3]) * t) / v);
      const cj = Math.floor((base[i * 3 + 1] + (tip[i * 3 + 1] - base[i * 3 + 1]) * t) / v);
      const ck = Math.floor((base[i * 3 + 2] + (tip[i * 3 + 2] - base[i * 3 + 2]) * t) / v);
      let a = a0;
      for (let l = 1; l <= P.shadeLayers; l++) {
        for (let di = -l; di <= l; di++)
          for (let dk = -l; dk <= l; dk++) {
            const kk = key(ci + di, cj - l, ck + dk);
            shade.set(kk, (shade.get(kk) || 0) + a);
          }
        a *= P.shadeDecay;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    const ci = Math.floor(tip[i * 3] / v), cj = Math.floor(tip[i * 3 + 1] / v), ck = Math.floor(tip[i * 3 + 2] / v);
    sh.light = clamp(1 - (shade.get(key(ci, cj, ck)) || 0), 0, 1);
  }
}
