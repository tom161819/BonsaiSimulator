import type { State } from './types';
import { P } from './params';
import { Frames, clamp, leafArea, ownFoliage } from './util';

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

/** v10: světlo u listů. Listová plocha se rozloží do jemné mřížky (tenké vodorovné vrstvy; list zabírá kruh
 *  o poloměru své délky) a nad každým výhonem se sečte, kolik listů mu stíní – kolmo shora a ze čtyř šikmých
 *  směrů, včetně listů v témže shluku. Světlo = průměr exp(−k × listová plocha podél paprsku na jednotku
 *  plochy), tedy Beerův–Lambertův zákon přes pět směrů oblohy.
 *  full = počítat s plně vyvinutými listy (odhad při jarním rašení). Výsledek je v sh.leafLight. */
export function computeLeafLight(s: State, fr: Frames, full = false): void {
  const n = s.shoots.length;
  let H = 1;
  for (let i = 0; i < n; i++) if (!s.shoots[i].dead) H = Math.max(H, fr.tip[i * 3 + 1]);
  const g = Math.max(P.leafCell10, H / P.leafCellPerHeight10), gy = Math.max(P.leafLayer10, H / P.leafLayerPerHeight10);
  const A = new Map<number, number>();
  const key = (i: number, j: number, k: number) => ((i + 2048) * 8192 + (j + 64)) * 4096 + (k + 2048);
  const { base, tip } = fr;
  const own = new Float64Array(n), ci = new Int32Array(n), cj = new Int32Array(n), ck = new Int32Array(n);
  let jmax = 0;
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    // světlo se měří u vyššího konce výhonu: vlastní listy má pod sebou, takže si výhon nestíní sám
    const te = tip[i * 3 + 1] >= base[i * 3 + 1] ? 0.95 : 0.05;
    ci[i] = Math.floor((base[i * 3] + (tip[i * 3] - base[i * 3]) * te) / g); cj[i] = Math.floor((base[i * 3 + 1] + (tip[i * 3 + 1] - base[i * 3 + 1]) * te) / gy); ck[i] = Math.floor((base[i * 3 + 2] + (tip[i * 3 + 2] - base[i * 3 + 2]) * te) / g);
    const f = leafArea(s, sh, full);
    if (f <= 0) continue;
    // listy jsou rozmístěné po délce výhonu; každý úsek je rozloží do kruhu o poloměru ~délky listu
    const m = Math.max(1, Math.min(24, Math.ceil(sh.len / g)));
    const R = Math.max(g * 0.75, sh.needleLen * 0.8), w = Math.min(4, Math.ceil(R / g));
    let wsum = 0;
    for (let di = -w; di <= w; di++) for (let dk = -w; dk <= w; dk++) wsum += Math.max(0, 1 - ((di * di + dk * dk) * g * g) / ((R + g) * (R + g)));
    own[i] = f / m / wsum;
    for (let q = 0; q < m; q++) {
      const t = (q + 0.5) / m;
      const xi = Math.floor((base[i * 3] + (tip[i * 3] - base[i * 3]) * t) / g), yj = Math.floor((base[i * 3 + 1] + (tip[i * 3 + 1] - base[i * 3 + 1]) * t) / gy), zk = Math.floor((base[i * 3 + 2] + (tip[i * 3 + 2] - base[i * 3 + 2]) * t) / g);
      if (yj > jmax) jmax = yj;
      for (let di = -w; di <= w; di++) for (let dk = -w; dk <= w; dk++) {
        const wt = 1 - ((di * di + dk * dk) * g * g) / ((R + g) * (R + g));
        if (wt <= 0) continue;
        const kk = key(xi + di, yj, zk + dk);
        A.set(kk, (A.get(kk) || 0) + (f / m) * (wt / wsum));
      }
    }
  }
  const g2 = g * g, slope = gy / g; // šikmý paprsek pod 45°: o kolik buněk do strany na jednu vrstvu vzhůru
  const DX = [0, 1, -1, 0, 0], DZ = [0, 0, 0, 1, -1];
  for (let i = 0; i < n; i++) {
    const sh = s.shoots[i];
    if (sh.dead) continue;
    // ve vlastní vrstvě stíní polovina cizích listů
    const here = (0.5 * Math.max(0, (A.get(key(ci[i], cj[i], ck[i])) || 0) - own[i])) / g2;
    let light = 0;
    for (let d = 0; d < 5; d++) {
      let lai = here;
      for (let t = 1; cj[i] + t <= jmax; t++) {
        const a = A.get(key(ci[i] + Math.round(DX[d] * t * slope), cj[i] + t, ck[i] + Math.round(DZ[d] * t * slope)));
        if (a) lai += a / g2;
      }
      light += 0.2 * Math.exp(-P.leafK10 * lai * (d === 0 ? 1 : 1.414));
    }
    sh.leafLight = light;
  }
}
