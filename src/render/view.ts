// 3D pohled: z čistého stavu simulace staví geometrii (dřevo, pupeny, jehlice), řeší kameru a výběr myší.
// Simulace o rendereru neví nic – renderer jen čte State.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PotType, Shoot, State } from '../sim/types';
import { P, potById } from '../sim/params';
import { LeafShape, speciesOf } from '../sim/species';
import leafAtlasJson from '../leafAtlas.json';
import type { Vec3 } from '../sim/types';
import { Frames, basis, clamp, computeFrames, spreadNebari, doyOf, needleGrowth, radiusOf, rnd, rotate, shootPoint, smooth, yearOf } from '../sim/util';

export type Pick =
  | { type: 'bud'; shoot: number; bud: number }
  | { type: 'shoot'; shoot: number; t: number };

class Buf {
  pos = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  nor = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  aux = new Float32Array(4096);
  idx = new Uint32Array(3 * 4096);
  nv = 0;
  ni = 0;
  reset() { this.nv = 0; this.ni = 0; }
  private grow(v: number, i: number) {
    if ((this.nv + v) * 3 > this.pos.length) {
      const cap = Math.max(this.pos.length * 2, (this.nv + v) * 3);
      for (const k of ['pos', 'col', 'nor'] as const) { const a = new Float32Array(cap); a.set(this[k]); this[k] = a; }
      const u = new Float32Array((cap / 3) * 2); u.set(this.uv); this.uv = u;
      const x = new Float32Array(cap / 3); x.set(this.aux); this.aux = x;
    }
    if (this.ni + i > this.idx.length) {
      const a = new Uint32Array(Math.max(this.idx.length * 2, this.ni + i)); a.set(this.idx); this.idx = a;
    }
  }
  reserve(v: number, i: number) { this.grow(v, i); }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number) {
    const o = this.nv * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
    // barvy jsou zadané v sRGB, renderer počítá lineárně
    this.col[o] = Math.pow(r, 2.2); this.col[o + 1] = Math.pow(g, 2.2); this.col[o + 2] = Math.pow(b, 2.2);
    return this.nv++;
  }
  /** souřadnice textury pro naposledy přidaný vrchol */
  t(u: number, v: number, bark = 0) { const o = (this.nv - 1) * 2; this.uv[o] = u; this.uv[o + 1] = v; this.aux[this.nv - 1] = bark; }
  tri(a: number, b: number, c: number) { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  apply(geo: THREE.BufferGeometry, withNormals: boolean) {
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.subarray(0, this.nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.subarray(0, this.nv * 3), 3));
    if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(this.nor.subarray(0, this.nv * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv.subarray(0, this.nv * 2), 2));
    geo.setAttribute('aBark', new THREE.BufferAttribute(this.aux.subarray(0, this.nv), 1));
    geo.setIndex(new THREE.BufferAttribute(this.idx.subarray(0, this.ni), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 100, 0), 1e5);
  }
}

const RAD = 6;

/** Periodický hodnotový šum (dlaždicovatelný) pro procedurální textury. */
function tileNoise(x: number, y: number, px: number, py: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const h = (i: number, j: number) => rnd(seed, ((i % px) + px) % px, ((j % py) + py) % py);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Borka borovice: podélně protažené šupinaté desky oddělené tmavými hlubokými prasklinami
 *  (dlaždicovatelný Voronoiův vzor). Slouží jako barva i jako reliéf. */
type BarkStyle = 'pine' | 'larch' | 'maple' | 'oak' | 'birch' | 'beech' | 'hornbeam';
const BARK_BUMP: Record<BarkStyle, number> = { pine: 6, larch: 6, maple: 5, oak: 9, birch: 2.5, beech: 1.5, hornbeam: 3 };

/** Kůra podle druhu: šupinaté desky (borovice, modřín), korkové hranoly (babyka), hluboké podélné brázdy (dub),
 *  bílá s tmavými čočinkami (bříza), hladká se skvrnami lišejníku (buk), hladká podélně žebrovaná (habr). */
function barkTexture(style: BarkStyle = 'pine'): THREE.CanvasTexture {
  const W = 256, H = 512;
  const GX = style === 'maple' ? 5 : style === 'larch' ? 7 : 8, GY = style === 'maple' ? 7 : style === 'larch' ? 3 : 4;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const wrap = (i: number, m: number) => ((i % m) + m) % m;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    // pokřivení, aby hrany desek nebyly rovné
    const px = (u + 0.035 * (tileNoise(u * 6, v * 8, 6, 8, 11) - 0.5)) * GX;
    const py = (v + 0.02 * (tileNoise(u * 8, v * 10, 8, 10, 12) - 0.5)) * GY;
    const ci = Math.floor(px), cj = Math.floor(py);
    let f1 = 9, f2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const gi = ci + di, gj = cj + dj, wi = wrap(gi, GX), wj = wrap(gj, GY);
      const qx = gi + 0.15 + 0.7 * rnd(31, wi, wj), qy = gj + 0.15 + 0.7 * rnd(32, wi, wj);
      const dd = Math.hypot(px - qx, py - qy);
      if (dd < f1) { f2 = f1; f1 = dd; id = wi * 17 + wj; } else if (dd < f2) f2 = dd;
    }
    const edge = f2 - f1;
    let plate = Math.min(1, edge / 0.11); // 0 = dno praskliny, 1 = plocha desky
    // jemnější vrstva odlupujících se šupin uvnitř desek
    const fine = Math.abs(2 * tileNoise(u * 14 + 3 * rnd(34, id, 2), v * 7, 14, 7, 42) - 1);
    plate *= 0.72 + 0.28 * Math.min(1, fine * 3);
    const flake = tileNoise(u * 40, v * 24, 40, 24, 40), grain = tileNoise(u * 64, v * 6, 64, 6, 41);
    const top = 0.66 + 0.2 * rnd(33, id, 1) + 0.12 * (flake - 0.5) + 0.1 * (grain - 0.5);
    let g = Math.max(0, Math.min(1, 0.24 + (top - 0.24) * Math.pow(plate, 0.6)));
    if (style === 'oak') {
      // dlouhé svislé hřebeny oddělené hlubokými brázdami
      const wob = 0.05 * (tileNoise(u * 3, v * 5, 3, 5, 51) - 0.5);
      const r1 = Math.abs(2 * tileNoise((u + wob) * 7, v * 1, 7, 1, 52) - 1), r2 = Math.abs(2 * tileNoise((u + wob) * 15, v * 3, 15, 3, 53) - 1);
      const ridge = Math.min(1, (r1 * 0.75 + r2 * 0.35) * 1.9);
      g = 0.16 + 0.6 * Math.pow(ridge, 0.5) + 0.12 * (grain - 0.5) + 0.06 * (flake - 0.5);
    } else if (style === 'birch') g = 0.78 + 0.03 * (flake - 0.5); // bílá; čočinky se dokreslí níže
    else if (style === 'beech') {
      const lichen = tileNoise(u * 5, v * 7, 5, 7, 54) > 0.66 ? 0.07 : 0;
      g = 0.72 + 0.1 * (tileNoise(u * 3, v * 4, 3, 4, 55) - 0.5) + lichen + 0.02 * (flake - 0.5);
    } else if (style === 'hornbeam') g = 0.7 + 0.16 * (tileNoise(u * 5, v * 1, 5, 1, 56) - 0.5) + 0.05 * (grain - 0.5);
    g = Math.max(0, Math.min(1, g));
    const o = (y * W + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(g * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (style === 'birch') {
    // vodorovné tmavé čočinky a několik černých kosočtverečných trhlin
    for (let i = 0; i < 150; i++) {
      const x = rnd(57, i, 1) * W, y = rnd(57, i, 2) * H, rx = 4 + 18 * rnd(57, i, 3), ry = 1 + 1.6 * rnd(57, i, 4);
      ctx.fillStyle = `rgba(40,36,32,${0.35 + 0.4 * rnd(57, i, 5)})`;
      for (const [dx, dy] of [[0, 0], [W, 0], [-W, 0], [0, H], [0, -H]]) { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, 6.2832); ctx.fill(); }
    }
    for (let i = 0; i < 7; i++) {
      const x = rnd(58, i, 1) * W, y = rnd(58, i, 2) * H, w = 8 + 14 * rnd(58, i, 3), h = 16 + 30 * rnd(58, i, 4);
      ctx.fillStyle = 'rgba(25,22,20,0.85)';
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath(); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Mladá větvička: jemné podélné rýhování, světlé čočinky a tmavší skvrnky. Šedá textura, kterou se
 *  násobí barva výhonu; kde už je borka, postupně mizí. */
function twigTexture(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const streak = tileNoise(u * 48, v * 3, 48, 3, 91) - 0.5, broad = tileNoise(u * 6, v * 2, 6, 2, 92) - 0.5, speck = tileNoise(u * 40, v * 40, 40, 40, 93) - 0.5;
    const g = Math.max(0, Math.min(1, 0.74 + 0.2 * streak + 0.12 * broad + 0.07 * speck));
    const o = (y * N + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(g * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 70; i++) { // čočinky: světlé protáhlé tečky s tmavším lemem
    const x = rnd(94, i, 1) * N, y = rnd(94, i, 2) * N, rx = 2 + 2.5 * rnd(94, i, 3), ry = 4 + 7 * rnd(94, i, 4);
    for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      ctx.fillStyle = 'rgba(60,50,40,0.35)'; ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx + 1.5, ry + 1.5, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(255,246,225,0.85)'; ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, 6.2832); ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Substrát: zrnitá směs (akadama, pemza, láva). */
function soilTexture(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#4a3b2f';
  ctx.fillRect(0, 0, N, N);
  const cols = ['#8a6a4a', '#6e5540', '#a08468', '#5a4a40', '#7a4f3a', '#9c9488', '#3c302a'];
  for (let i = 0; i < 2600; i++) {
    const x = rnd(5, i, 1) * N, y = rnd(5, i, 2) * N, r = 2 + rnd(5, i, 3) * 4.5;
    ctx.fillStyle = cols[Math.floor(rnd(5, i, 4) * cols.length)];
    for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * (0.6 + 0.4 * rnd(5, i, 5)), rnd(5, i, 6) * 3.14, 0, 6.2832);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Atlas listů 4 × 2: buňka 0 je bílá (jehlice borovice a modřínu), další nesou list daného tvaru
 *  s pilovitým okrajem, střední žilkou a postranními žilkami. Barvu dodává vrchol, textura jen kresbu. */
const LEAF_CELL: Record<string, [number, number]> = { ovate: [1, 0], beech: [2, 0], delta: [3, 0], lobed: [0, 1], palmate: [1, 1] };
function leafAtlas(): THREE.CanvasTexture {
  const C = 256, W = C * 4, H = C * 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, H - C, C, C); // buňka (0,0) = levý dolní roh
  const spec: Record<string, { teeth: number; amp: number; veins: number; palm?: boolean }> = {
    ovate: { teeth: 26, amp: 0.022, veins: 11 }, beech: { teeth: 14, amp: 0.012, veins: 8 }, delta: { teeth: 16, amp: 0.03, veins: 6 },
    lobed: { teeth: 0, amp: 0, veins: 5 }, palmate: { teeth: 0, amp: 0, veins: 0, palm: true },
  };
  for (const [name, [cx, cy]] of Object.entries(LEAF_CELL)) {
    const half = LEAF[name as keyof typeof LEAF], sp = spec[name];
    const ox = cx * C + C / 2, oy = H - cy * C - C * 0.04, S = C * 0.92;
    const X = (x: number) => ox + x * S, Y = (y: number) => oy - y * S;
    // obrys: pravá polovina, zrcadlově levá; mezi body vložené zoubky
    const pts: [number, number][] = [];
    const side = (sgn: number, list: [number, number][]) => {
      for (let i = 0; i < list.length - 1; i++) {
        const [x0, y0] = list[i], [x1, y1] = list[i + 1];
        const n = sp.teeth ? Math.max(1, Math.round((sp.teeth * Math.hypot(x1 - x0, y1 - y0)) / 1.3)) : 1;
        for (let k = 0; k < n; k++) {
          const f = k / n, tooth = sp.teeth && k % 2 ? sp.amp * (0.5 + rnd(62, i * 31 + k, sgn + 2)) : 0;
          const nx = y1 - y0, ny = -(x1 - x0), nl = Math.hypot(nx, ny) || 1;
          pts.push([sgn * (x0 + (x1 - x0) * f + (nx / nl) * tooth), y0 + (y1 - y0) * f + (ny / nl) * tooth]);
        }
      }
    };
    side(1, half);
    side(-1, half.slice().reverse().map(([x, y]) => [x, y] as [number, number]));
    ctx.save();
    ctx.beginPath();
    if (name === 'lobed') {
      // zaoblené laloky: křivka vedená středy hran
      const n = pts.length, mid = (i: number): [number, number] => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
      ctx.moveTo(X(mid(0)[0]), Y(mid(0)[1]));
      for (let i = 1; i <= n; i++) { const p = pts[i % n], m = mid(i); ctx.quadraticCurveTo(X(p[0]), Y(p[1]), X(m[0]), Y(m[1])); }
    } else pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    const g = ctx.createLinearGradient(X(-0.5), 0, X(0.5), 0);
    g.addColorStop(0, '#a9a9a9'); g.addColorStop(0.5, '#bdbdbd'); g.addColorStop(1, '#a6a6a6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // jemná skvrnitost čepele
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rnd(61, i, 1) < 0.5 ? '255,255,255' : '90,90,90'},${0.05 + 0.06 * rnd(61, i, 2)})`;
      ctx.beginPath();
      ctx.arc(cx * C + rnd(61, i, 3) * C, H - cy * C - rnd(61, i, 4) * C, 3 + 7 * rnd(61, i, 5), 0, 6.2832);
      ctx.fill();
    }
    // žilky: světlá střední, tmavší stín vedle ní, postranní k okraji
    // žilky: mírně prohnuté, nestejně rozmístěné, k okraji slábnou; mezi nimi jemná síť
    const vein = (x0: number, y0: number, x1: number, y1: number, w: number, bend = 0) => {
      const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
      for (const [col, lw] of [['rgba(70,70,70,0.3)', w + 2.2], ['rgba(255,255,255,0.7)', w]] as [string, number][]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.quadraticCurveTo(X(mx), Y(my), X(x1), Y(y1)); ctx.stroke();
      }
    };
    const net = (x: number, y: number) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 0.7;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + (rnd(63, cx * 9 + i, Math.round(y * 97)) - 0.5) * 0.16), Y(y + (rnd(64, cx * 9 + i, Math.round(x * 89)) - 0.3) * 0.12)); ctx.stroke(); }
    };
    if (sp.palm) for (const a of [-1.15, -0.6, 0, 0.6, 1.15]) {
      const ex = Math.sin(a) * 0.5, ey = 0.08 + Math.cos(a) * (a ? 0.6 : 0.9);
      vein(0, 0.08, ex, ey, a ? 1.6 : 2.4, a * 0.04);
      for (let q = 1; q <= 4; q++) for (const sg of [-1, 1]) { const f = q / 5; vein(ex * f, 0.08 + (ey - 0.08) * f, ex * f + sg * 0.1 * Math.cos(a), 0.08 + (ey - 0.08) * f + 0.09 + sg * 0.05 * Math.sin(-a), 0.8, sg * 0.1); }
    } else {
      vein(0, 0, 0.01, 0.98, 2.4, 0.02);
      for (let k = 1; k <= sp.veins; k++) for (const sgn of [-1, 1]) {
        const jit = (rnd(65, cx * 7 + k, sgn + 2) - 0.5) * (0.5 / (sp.veins + 1));
        const y = 0.06 + (0.84 * (k + (sgn > 0 ? 0.25 : 0))) / (sp.veins + 1) + jit, reach = 0.5 * Math.sin(Math.PI * Math.min(1, y + 0.12));
        vein(0, y, sgn * reach, y + 0.14 + reach * 0.3 + jit, 1.1, -sgn * 0.12);
        net(sgn * reach * 0.45, y + 0.1); net(sgn * reach * 0.75, y + 0.16);
      }
    }
    ctx.restore();
  }
  // průhledné okolí dostane barvu čepele, aby zmenšené úrovně textury neměly tmavý lem
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 0) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 180; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deska stolu: prkna s kresbou dřeva. */
function woodTexture(): THREE.CanvasTexture {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  const planks = 4, ph = N / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.82 + 0.3 * rnd(71, p, 1);
    ctx.fillStyle = `rgb(${Math.round(126 * tone)},${Math.round(94 * tone)},${Math.round(62 * tone)})`;
    ctx.fillRect(0, p * ph, N, ph);
    for (let i = 0; i < 46; i++) { // léta dřeva: vlnité podélné čáry
      const y0 = p * ph + rnd(71, p * 100 + i, 2) * ph, amp = 2 + 5 * rnd(71, p * 100 + i, 3), f = 1 + Math.floor(2 * rnd(71, p * 100 + i, 4));
      ctx.strokeStyle = `rgba(${rnd(71, p * 100 + i, 5) < 0.6 ? '60,38,20' : '200,160,110'},${0.1 + 0.16 * rnd(71, p * 100 + i, 6)})`;
      ctx.lineWidth = 0.6 + 1.6 * rnd(71, p * 100 + i, 7);
      ctx.beginPath();
      for (let x = 0; x <= N; x += 16) { const y = y0 + amp * Math.sin((x / N) * 6.2832 * f + i); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,18,10,0.55)';
    ctx.fillRect(0, p * ph, N, 2.5); // spára mezi prkny
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Pozadí: obloha s oparem u obzoru a pod ním rozostřená zahrada (světlé a tmavé zelené skvrny). */
function backdropTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  // stromy v pozadí sahají nad obzor, aby byly vidět i při pohledu mírně shora
  sky.addColorStop(0, '#8fb6d8'); sky.addColorStop(0.26, '#c3d9e8'); sky.addColorStop(0.36, '#dde7df');
  sky.addColorStop(0.42, '#a3b98f'); sky.addColorStop(0.6, '#728c63'); sky.addColorStop(1, '#5b6f52');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 520; i++) { // rozostřené koruny a keře kolem obzoru
    const x = rnd(81, i, 1) * W, y = H * (0.3 + 0.4 * Math.pow(rnd(81, i, 2), 0.8)), r = 18 + 60 * rnd(81, i, 3);
    const light = rnd(81, i, 4);
    const col = light < 0.25 ? '225,235,190' : light < 0.6 ? '120,150,95' : '70,100,70';
    for (const dx of [0, W, -W]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, `rgba(${col},${0.2 + 0.25 * rnd(81, i, 5)})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Podložka pod nádobou: do ztracena mizející kruh, na který dopadá stín. */
function fadeTexture(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(N / 2, N / 2, N * 0.12, N / 2, N / 2, N / 2);
  // alphaMap čte jas, ne průhlednost: bílá = plná, černá = průhledná
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, N, N);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.5, '#aaa');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(cv);
}
const MAX_FASCICLES = 30000;

/** Obrys listu: body (x, y), x = do šířky (−0,5…0,5), y = podél listu (0 = řapík, 1 = špička). Pravá polovina; levá je zrcadlová. */
const LEAF: Record<Exclude<LeafShape, 'needle' | 'tuft'>, [number, number][]> = {
  ovate: [[0, 0], [0.3, 0.14], [0.48, 0.4], [0.4, 0.68], [0.18, 0.9], [0, 1]], // habr: vejčitý, zašpičatělý
  beech: [[0, 0], [0.36, 0.16], [0.5, 0.45], [0.42, 0.74], [0.16, 0.94], [0, 1]], // buk: široce vejčitý
  delta: [[0, 0], [0.5, 0.16], [0.36, 0.48], [0.14, 0.82], [0, 1]], // bříza: trojúhelníkovitý
  lobed: [[0, 0], [0.14, 0.05], [0.1, 0.16], [0.34, 0.26], [0.2, 0.38], [0.48, 0.52], [0.26, 0.63], [0.44, 0.8], [0.18, 0.86], [0.12, 0.98], [0, 1]], // dub: laločnatý
  palmate: [[0, 0.05], [0.16, 0], [0.5, 0.1], [0.3, 0.3], [0.5, 0.52], [0.24, 0.55], [0.16, 0.74], [0, 1]], // javor babyka: dlanitý
};

function woodColor(s: State, sh: Shoot, out: number[]) {
  const age = yearOf(s.day) - sh.bornYear;
  const r = radiusOf(sh);
  let c: number[];
  const sp = speciesOf(s);
  if (sp.kind === 'leafy' && !sh.dead) {
    // letorost zelený, pak barva větviček, s věkem kůra druhu (bříza bělá, buk šedne, dub tmavne)
    if (age === 0 && sh.elong) c = [0.5, 0.6, 0.3];
    else if (age <= 1) c = sp.twigColor;
    else {
      const k = smooth((age - 1) / Math.max(2, sp.barkAge * 0.6)), k2 = smooth((age - sp.barkAge) / (sp.barkAge + 4));
      c = [0, 1, 2].map((q) => (sp.twigColor[q] + (sp.barkColor[q] - sp.twigColor[q]) * k) * (1 - k2) + sp.oldBarkColor[q] * k2);
    }
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return;
  }
  if (sh.dead) c = [0.7, 0.67, 0.61];
  else if (sh.kind === 'hypocotyl' && age === 0) c = [0.62, 0.47, 0.4];
  else if (sh.elong && sh.kind === 'shoot') {
    const e = sh.targetLen > 0 ? sh.len / sh.targetLen : 1;
    c = [0.76 - 0.26 * e, 0.7 - 0.14 * e, 0.5 - 0.2 * e]; // svíčka: plavá -> zelená
  } else if (age === 0) c = [0.47, 0.53, 0.3];
  else if (age <= 3) c = [0.5, 0.43, 0.33];
  else {
    // mladší borka oranžová a šupinatá, stará a silná šedohnědé desky (u bonsaje rozhoduje hlavně stáří)
    const k = Math.max(smooth((r - 1.2) / 3.5), smooth((age - 7) / 14));
    c = [0.76 - 0.2 * k, 0.52 - 0.1 * k, 0.32 + 0.07 * k];
  }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

export class TreeView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 20000);
  private wood = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.3 }));
  private bark: THREE.Mesh;
  private barkStyle: BarkStyle | '' = '';
  private photoU = { value: 0 };
  private photoCache = new Map<string, { d: THREE.Texture; n: THREE.Texture } | null>();
  private barkCache = new Map<BarkStyle, THREE.CanvasTexture>();
  private leafTex: THREE.Texture = leafAtlas();
  /** rozložení atlasu listů: kreslený má 4 × 2 políčka a jeden list na tvar, fotografický víc variant */
  private leafGrid: { cols: number; rows: number; cells: Record<string, number[][]> } = { cols: 4, rows: 2, cells: Object.fromEntries(Object.entries(LEAF_CELL).map(([k, v]) => [k, [v]])) };
  private needles = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x1c2a1c, map: this.leafTex, alphaTest: 0.4 }));
  private backdrop = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ map: backdropTexture(), side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false }));
  private sunU = { uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
  private sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
  private soilTex = soilTexture();
  private table: THREE.Mesh;
  private bb = new Buf();
  private hi = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private wireLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
  private wireDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ vertexColors: true, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
  private wiresOn = false;
  private potGroup = new THREE.Group();
  private tree = new THREE.Group();
  private potKey = '';
  private seedMesh: THREE.Mesh;
  private wb = new Buf();
  private nb = new Buf();
  private state: State | null = null;
  private frames: Frames | null = null;
  private builtDist = 0;

  // kamera (sférické souřadnice kolem cíle)
  target = new THREE.Vector3(0, 3, 0);
  dist = 40;
  theta = 0.6;
  phi = 1.25;
  auto = true;
  height = 0;
  private needsRender = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // odlesky a měkké okolní světlo z jednoduchého prostředí (glazura misek, kůra)
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a6a55, 0.75));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    const barkTex = barkTexture();
    this.barkCache.set('pine', barkTex);
    const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, map: barkTex, bumpMap: barkTex, bumpScale: 6, envMapIntensity: 0.3 });
    // síla borky je ve vrcholech (aBark 0..1): mladé dřevo hladké, staré hluboce rozpraskané, s plynulým přechodem
    barkMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', 'attribute float aBark;\nvarying float vBark;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBark = aBark;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', 'varying float vBark;\n#include <common>')
        .replace('#include <common>', 'uniform float uPhoto;\nuniform sampler2D uTwig;\n#include <common>')
        .replace('#include <map_fragment>', '#ifdef USE_MAP\n vec3 barkTex = texture2D(map, vMapUv).rgb;\n diffuseColor.rgb *= mix(texture2D(uTwig, vMapUv * vec2(1.0, 3.0)).rgb * 1.3, vec3(1.0), smoothstep(0.0, 0.6, vBark));\n diffuseColor.rgb = uPhoto > 0.5 ? mix(diffuseColor.rgb, barkTex * 1.6, vBark) : diffuseColor.rgb * mix(vec3(1.0), barkTex * 1.3, vBark);\n#endif')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd(), faceDirection', 'dHdxy_fwd() * vBark, faceDirection').replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vBark;'));
      sh.uniforms.uPhoto = this.photoU;
      sh.uniforms.uTwig = { value: twigTexture() };
    };
    this.bark = new THREE.Mesh(new THREE.BufferGeometry(), barkMat);
    this.addWind(barkMat, 'bark', false, false);
    this.addWind(this.wood.material as THREE.Material, 'wood', false, false);
    this.addWind(this.needles.material as THREE.Material, 'needles', true, true);
    this.sun.shadow.autoUpdate = false; // stín se přepočítá jen při změně stromu, ne při každém snímku s větrem
    for (const m of [this.wood, this.bark, this.needles]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    // stůl: prkenná deska pod nádobou (u volné půdy skrytá)
    this.table = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.75, envMapIntensity: 0.35 }));
    this.table.receiveShadow = true;
    this.backdrop.renderOrder = -5;
    this.backdrop.frustumCulled = false;
    this.scene.add(this.backdrop);
    // listy: stín respektuje výřez listu; proti slunci list prosvítá
    this.needles.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.leafTex, alphaTest: 0.4 });
    const leafMat = this.needles.material as THREE.MeshPhongMaterial;
    leafMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.sunU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', 'uniform vec3 uSunDir;\n#include <common>')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float through = pow(max(dot(-normalize(vViewPosition), uSunDir), 0.0), 2.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.1, 1.15, 0.6) * through * 0.55;`);
    };
    // naskenované listy (assets/tex/leaves.webp); dokud se nenačtou, slouží kreslený atlas
    new THREE.TextureLoader().load('tex/leaves.webp', (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const old = this.leafTex;
      this.leafTex = t;
      leafMat.map = t; leafMat.needsUpdate = true;
      const dm = this.needles.customDepthMaterial as THREE.MeshDepthMaterial;
      dm.map = t; dm.needsUpdate = true;
      this.leafGrid = leafAtlasJson as unknown as typeof this.leafGrid;
      old.dispose();
      if (this.state) this.build();
    }, undefined, () => undefined);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.scene.add(this.table);
    this.makeTools();
    this.hi.renderOrder = 10; this.marker.renderOrder = 11;
    this.wireLines.renderOrder = 8; this.wireDots.renderOrder = 9;
    this.wireLines.visible = false; this.wireDots.visible = false;
    this.scene.add(this.wireLines, this.wireDots);
    this.hi.visible = false; this.marker.visible = false;
    this.seedMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.8 }));
    this.seedMesh.scale.set(0.22, 0.12, 0.14);
    this.seedMesh.position.set(0, 0.1, 0);
    this.tree.add(this.wood, this.bark, this.needles);
    this.tree.rotation.order = 'ZXY';
    this.scene.add(this.tree, this.hi, this.marker, this.potGroup, this.seedMesh);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  // ------------------------------------------------------------ kamera

  orbit(dx: number, dy: number) {
    this.theta -= dx * 0.008;
    this.phi = clamp(this.phi - dy * 0.006, 0.15, 1.62);
    this.needsRender = true;
  }
  pan(dx: number, dy: number) {
    const k = (this.dist * 0.56) / (this.canvas.clientHeight || 1);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.auto = false; this.needsRender = true;
  }
  zoom(f: number) {
    this.dist = clamp(this.dist * f, 6, 6000);
    this.auto = false; this.needsRender = true;
  }
  recenter() { this.auto = true; this.needsRender = true; }

  /** Portrét stromu pro sbírku: celý strom i s nádobou na průhledném pozadí, z právě zvoleného směru pohledu. */
  capture(w = 360, h = 440): string {
    const s = this.state;
    if (!s) return '';
    const keep = { target: this.target.clone(), dist: this.dist, phi: this.phi, auto: this.auto, pr: this.renderer.getPixelRatio() };
    const hidden = [this.hi, this.marker, this.wireLines, this.wireDots, this.table, this.backdrop, this.toolScissors, this.toolWire].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const pot = potById(s.potId);
    const H = Math.max(6, this.height), below = pot.shape === 'ground' ? 1 : pot.h + 2;
    // skutečný rozsah koruny do stran (strom může být širší než vyšší)
    // šířka koruny: 92. percentil vzdálenosti špiček od osy – jedna dlouhá větev nemá zmenšit celý portrét
    const rs: number[] = [];
    if (this.frames) for (let i = 0; i < s.shoots.length; i++) if (!s.shoots[i].dead) rs.push(Math.hypot(this.frames.tip[i * 3], this.frames.tip[i * 3 + 2]));
    rs.sort((a, b) => a - b);
    const reach = rs.length ? Math.max(rs[Math.floor(rs.length * 0.92)], rs[rs.length - 1] * 0.6) : 0;
    const span = H + below + 3, width = Math.max(2 * reach + 8, pot.a + 4, pot.b + 4);
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    this.auto = false;
    this.phi = 1.38;
    this.dist = Math.max(span / 2 / tan, width / 2 / (tan * (w / h))) * 1.08;
    // dno nádoby sedí na spodním okraji obrázku, aby strom na lavici stál a nevznášel se
    this.target.set(0, -below + this.dist * tan * 0.97, 0);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    for (const o of hidden) o.visible = true;
    this.target.copy(keep.target); this.dist = keep.dist; this.phi = keep.phi; this.auto = keep.auto;
    this.renderer.setPixelRatio(keep.pr);
    this.resize();
    return url;
  }
  /** Pohled zepředu (osa Z míří k pozorovateli) – vůči němu se zadává náklon při přesazení. */
  front() { this.theta = 0; this.phi = 1.3; this.auto = true; this.needsRender = true; }
  /** Náhled natočení a náklonu při přesazení (stupně), než se zásah potvrdí. */
  previewRotation(yaw: number, tiltX: number, tiltZ: number) {
    const r = Math.PI / 180;
    this.tree.rotation.set(tiltX * r, yaw * r, tiltZ * r);
    this.needsRender = true;
  }

  private updateCamera() {
    if (this.auto) {
      const H = Math.max(4, this.height);
      const narrow = this.camera.aspect < 0.8 ? 1.5 : 1;
      // záběr zahrnuje i nádobu a desku stolu s nářadím
      const bottom = this.table.visible ? this.tableTop : 0, span = H - bottom;
      const td = (span * 2.05 + 26) * narrow, ty = bottom + span * 0.5;
      if (Math.abs(td - this.dist) > 0.01 || Math.abs(ty - this.target.y) > 0.01) {
        this.dist += (td - this.dist) * 0.12;
        this.target.x *= 0.88; this.target.z *= 0.88;
        this.target.y += (ty - this.target.y) * 0.12;
        this.needsRender = true;
      }
    }
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.dist * sp * Math.sin(this.theta),
      this.target.y + this.dist * Math.cos(this.phi),
      this.target.z + this.dist * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(0.3, this.dist * 0.02);
    this.camera.far = this.dist * 40 + 2000;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  frame() {
    this.updateCamera();
    // šířka jehlic se přizpůsobuje vzdálenosti, při větším přiblížení/oddálení je třeba přestavět
    if (this.state && Math.abs(Math.log(this.dist / this.builtDist)) > 0.25) this.build();
    if (this.windOn) { this.windU.uTime.value = performance.now() / 1000; this.needsRender = true; }
    this.backdrop.position.copy(this.camera.position);
    this.backdrop.scale.setScalar(this.camera.far * 0.9); // koule pozadí musí zůstat uvnitř dohledu kamery
    this.sunU.uSunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize().transformDirection(this.camera.matrixWorldInverse);
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ nádoba

  private windU = { uTime: { value: 0 }, uAmp: { value: 0 }, uH: { value: 10 } };
  private windOn = false;
  /** Vítr: kolébání koruny a chvění jehlic (jen ve vertex shaderu, simulace se nemění). */
  setWind(on: boolean) { this.windOn = on; this.windU.uAmp.value = on ? 0.006 : 0; this.needsRender = true; }

  private addWind(mat: THREE.Material, key: string, flutter: boolean, declareAttr: boolean) {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      Object.assign(sh.uniforms, this.windU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `uniform float uTime, uAmp, uH;\n${declareAttr ? 'attribute float aBark;\n' : ''}#include <common>`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wh = clamp(transformed.y / uH, 0.0, 1.2);
          float wp = transformed.x * 0.05 + transformed.z * 0.04;
          float gust = 0.55 + 0.45 * sin(uTime * 0.6);
          transformed.xz += vec2(sin(uTime * 1.3 + wp) + 0.4 * sin(uTime * 2.7 + wp * 2.1), 0.6 * cos(uTime * 1.1 + wp * 1.4)) * uAmp * uH * wh * wh * gust;
          ${flutter ? 'transformed.xyz += aBark * (uAmp / 0.006) * 0.05 * gust * vec3(sin(uTime * 5.0 + transformed.x * 2.3 + transformed.y * 1.7), sin(uTime * 4.3 + transformed.z * 2.9), cos(uTime * 4.7 + transformed.z * 2.1));' : ''}`);
    };
    mat.customProgramCacheKey = () => key;
  }

  private tableTop = 0;
  private toolScissors = new THREE.Group();
  private toolWire = new THREE.Group();
  private activeTool: 'cut' | 'wire' = 'cut';

  /** Nářadí na stole: bonsajové nůžky a cívka měděného drátu. Kliknutím se volí nástroj. */
  private makeTools() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.35, metalness: 0.85 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.25, metalness: 0.9 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb8692e, roughness: 0.4, metalness: 0.8 });
    const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, 0);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    };
    // nůžky (jednotková velikost ~ 1 na délku): dvě zkřížená ramena, každé = čepel + stopka + velké oko
    for (const sgn of [-1, 1]) {
      const arm = new THREE.Group();
      const blade = new THREE.Shape();
      blade.moveTo(0, -0.028); blade.lineTo(0.42, -0.004); blade.lineTo(0.42, 0.004); blade.lineTo(0, 0.045); blade.closePath();
      add(arm, new THREE.ExtrudeGeometry(blade, { depth: 0.016, bevelEnabled: false }).rotateX(-Math.PI / 2), edge, 0, 0, 0);
      add(arm, new THREE.BoxGeometry(0.2, 0.02, 0.035), steel, -0.1, 0.01, 0);
      add(arm, new THREE.TorusGeometry(0.115, 0.02, 8, 24).rotateX(Math.PI / 2), steel, -0.3, 0.01, sgn * 0.085);
      arm.rotation.y = sgn * 0.17;
      arm.position.y = sgn > 0 ? 0.03 : 0.012;
      this.toolScissors.add(arm);
    }
    add(this.toolScissors, new THREE.CylinderGeometry(0.022, 0.022, 0.06, 12), edge, 0, 0.03, 0);
    // cívka drátu: několik závitů na sobě a volný konec
    for (let k = 0; k < 5; k++) add(this.toolWire, new THREE.TorusGeometry(0.3 - 0.006 * (k % 2), 0.022, 8, 40).rotateX(Math.PI / 2), copper, (k % 2) * 0.01, 0.024 + k * 0.04, 0);
    add(this.toolWire, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8).rotateZ(Math.PI / 2), copper, 0.36, 0.024, 0.27, 0.5);
    this.scene.add(this.toolScissors, this.toolWire);
  }

  /** Který nástroj na stole leží pod kurzorem (souřadnice plátna). */
  pickTool(x: number, y: number): 'cut' | 'wire' | null {
    const W = this.canvas.clientWidth, Hh = this.canvas.clientHeight, v = new THREE.Vector3(), e = new THREE.Vector3();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    for (const [g, id] of [[this.toolScissors, 'cut'], [this.toolWire, 'wire']] as [THREE.Group, 'cut' | 'wire'][]) {
      if (!g.visible) continue;
      v.copy(g.position).project(this.camera);
      if (v.z > 1 || v.z < -1) continue; // za kamerou nebo mimo dohled
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * Hh;
      // skutečná velikost nástroje na obrazovce: promítnutý bod na jeho okraji
      e.copy(g.position).addScaledVector(right, g.scale.x * 0.4).project(this.camera);
      const rad = Math.min(90, Math.max(14, Math.abs((e.x * 0.5 + 0.5) * W - sx)));
      if (Math.hypot(sx - x, sy - y) < rad) return id;
    }
    return null;
  }

  /** Zvolený nástroj je na stole nadzvednutý. */
  setActiveTool(t: 'cut' | 'wire') { this.activeTool = t; if (this.state) this.build(); }
  private jointEnds: Record<number, number[]> = {};
  jointGap = { rel: 0, parent: -1, child: -1, info: '' };
  attachGap = 0;
  private potOverride: string | null = null;
  /** Náhled jiné nádoby v dialogu přesazení (null = skutečná nádoba stromu). */
  private spreadPreview = 0;
  private offsetPreview: [number, number] | null = null;
  /** Náhled při přesazení: rozprostření kořenů (0–1) a posun stromu v nádobě (null = skutečný stav). */
  previewRoots(spread: number, offset: [number, number] | null) {
    if (this.spreadPreview === spread && JSON.stringify(this.offsetPreview) === JSON.stringify(offset)) return;
    this.spreadPreview = spread; this.offsetPreview = offset;
    if (this.state) this.build();
  }

  previewPot(id: string | null) {
    if (this.potOverride === id) return;
    this.potOverride = id;
    if (this.state) this.build();
  }

  /** Nádoba z katalogu v pevných rozměrech (cm); povrch substrátu je v rovině y = 0. */
  private updatePot(potId: string, H: number) {
    const spec = potById(this.potOverride ?? potId);
    const groundR = Math.max(12, Math.round((H * 0.3) / 10) * 10);
    const key = spec.id + (spec.shape === 'ground' ? groundR : '');
    if (key === this.potKey) return;
    this.potKey = key;
    for (const c of [...this.potGroup.children]) {
      this.potGroup.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const tex = this.soilTex.clone();
    tex.needsUpdate = true;
    const span = spec.shape === 'ground' ? groundR * 2 : Math.max(spec.a, spec.b);
    tex.repeat.set(Math.max(1.5, span / 10), Math.max(1.5, span / 10));
    const soil = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, envMapIntensity: 0.25 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sz = 1) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z); mesh.scale.set(sx, 1, sz);
      mesh.receiveShadow = true; mesh.castShadow = m !== soil;
      this.potGroup.add(mesh);
      return mesh;
    };
    this.table.visible = spec.shape !== 'ground';
    if (spec.shape === 'ground') {
      add(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7a4a, roughness: 1 }), 0, -0.25).castShadow = false;
      add(new THREE.CircleGeometry(groundR, 40).rotateX(-Math.PI / 2), soil);
      return;
    }
    const wall = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.glaze ? 0.3 : 0.85, metalness: spec.glaze ? 0.05 : 0, envMapIntensity: spec.glaze ? 1 : 0.3, side: THREE.DoubleSide });
    const { a, b, h } = spec;
    const lip = Math.max(0.35, h * 0.06); // okraj nad substrátem
    const dish = spec.type === 'bonsai';
    const footH = dish ? Math.max(0.5, h * 0.14) : 0;
    if (spec.shape === 'rect') {
      const t = Math.max(0.5, a * 0.03), top = lip, hh = h + lip;
      add(new THREE.BoxGeometry(a, hh, t), wall, 0, top - hh / 2, b / 2 - t / 2);
      add(new THREE.BoxGeometry(a, hh, t), wall, 0, top - hh / 2, -b / 2 + t / 2);
      add(new THREE.BoxGeometry(t, hh, b), wall, a / 2 - t / 2, top - hh / 2, 0);
      add(new THREE.BoxGeometry(t, hh, b), wall, -a / 2 + t / 2, top - hh / 2, 0);
      add(new THREE.BoxGeometry(a, t, b), wall, 0, -h + t / 2, 0);
      // přesahující horní lem, typický pro obdélníkové misky
      add(new THREE.BoxGeometry(a + t * 1.6, t * 0.7, t * 1.8), wall, 0, top - t * 0.35, b / 2 - t * 0.1);
      add(new THREE.BoxGeometry(a + t * 1.6, t * 0.7, t * 1.8), wall, 0, top - t * 0.35, -b / 2 + t * 0.1);
      add(new THREE.BoxGeometry(t * 1.8, t * 0.7, b + t * 1.6), wall, a / 2 - t * 0.1, top - t * 0.35, 0);
      add(new THREE.BoxGeometry(t * 1.8, t * 0.7, b + t * 1.6), wall, -a / 2 + t * 0.1, top - t * 0.35, 0);
      add(new THREE.PlaneGeometry(a - t * 2, b - t * 2).rotateX(-Math.PI / 2), soil);
      for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.BoxGeometry(a * 0.16, footH, b * 0.16), wall, fx * a * 0.38, -h - footH / 2, fz * b * 0.36);
    } else {
      const r = a / 2, sz = b / a, taper = dish ? 0.88 : 0.76;
      add(new THREE.CylinderGeometry(r, r * taper, h + lip, 56, 1, true), wall, 0, lip - (h + lip) / 2, 0, 1, sz);
      add(new THREE.TorusGeometry(r, Math.max(0.3, r * 0.045), 10, 56).rotateX(Math.PI / 2), wall, 0, lip, 0, 1, sz);
      add(new THREE.CylinderGeometry(r * taper, r * taper, 0.4, 56), wall, 0, -h + 0.2, 0, 1, sz);
      add(new THREE.CircleGeometry(r * 0.985, 56).rotateX(-Math.PI / 2), soil, 0, 0, 0, 1, sz);
      if (dish) for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * 6.2832 + 0.5;
        add(new THREE.BoxGeometry(r * 0.3, footH, r * 0.22), wall, Math.cos(ang) * r * 0.62, -h - footH / 2, Math.sin(ang) * r * 0.62 * sz);
      }
    }
    if (dish) {
      // polštářky mechu na substrátu
      const moss = new THREE.MeshStandardMaterial({ color: 0x4a6628, roughness: 1, envMapIntensity: 0.15, flatShading: true });
      for (let c = 0; c < 4; c++) {
        const ang = rnd(77, c, 1) * 6.2832, rad = 0.2 + 0.2 * rnd(77, c, 2);
        const ox = Math.cos(ang) * a * rad, oz = Math.sin(ang) * b * rad;
        const base = Math.min(a, b) * 0.028;
        for (let k = 0; k < 7; k++) {
          const mr = Math.max(0.35, base * (0.6 + 0.9 * rnd(77, c * 10 + k, 3)));
          const m = add(new THREE.IcosahedronGeometry(mr, 1), moss,
            ox + (rnd(77, c * 10 + k, 4) - 0.5) * base * 5, mr * 0.1, oz + (rnd(77, c * 10 + k, 5) - 0.5) * base * 5);
          m.scale.set(1.2, 0.5 + 0.3 * rnd(77, c * 10 + k, 6), 1.2);
          m.rotation.set(rnd(77, k, 7), rnd(77, k, 8) * 3, 0);
        }
      }
    }
    this.tableTop = -h - footH - 0.02;
  }

  // ------------------------------------------------------------ geometrie stromu

  setState(s: State) {
    this.state = s;
    this.build();
    if (this.wiresOn) this.showWires(true);
  }

  /** Zvýrazní všechny nadrátované výhony (svítivá čára s body podél drátu, viditelná i skrz jehlice). */
  showWires(on: boolean) {
    this.wiresOn = on;
    const s = this.state, fr = this.frames;
    const lines: number[] = [], dots: number[] = [], lineCol: number[] = [], dotCol: number[] = [];
    if (on && s && fr) {
      for (let i = 0; i < s.shoots.length; i++) {
        const sh = s.shoots[i];
        if (!sh.wire) continue;
        // červená = drát zarůstá, oranžová = tvar už drží nad 90 % (lze sundat), zelená = nový drát
        const c = sh.scar ? [1, 0.16, 0.1] : sh.wire.set >= 0.9 ? [1, 0.55, 0.05] : [0.2, 0.85, 0.3];
        const seg = Math.max(sh.arc ? 12 : 4, Math.min(24, Math.round(sh.len / 1.5)));
        let p = [fr.base[i * 3], fr.base[i * 3 + 1], fr.base[i * 3 + 2]];
        dots.push(...p); dotCol.push(...c);
        for (let k = 1; k <= seg; k++) {
          const q = shootPoint(sh, k / seg);
          const n = [fr.base[i * 3] + q[0], fr.base[i * 3 + 1] + q[1], fr.base[i * 3 + 2] + q[2]];
          lines.push(...p, ...n); lineCol.push(...c, ...c);
          dots.push(...n); dotCol.push(...c);
          p = n;
        }
      }
    }
    for (const [obj, pts, cols] of [[this.wireLines, lines, lineCol], [this.wireDots, dots, dotCol]] as [THREE.Object3D & { geometry: THREE.BufferGeometry }, number[], number[]][]) {
      obj.geometry.dispose();
      obj.geometry = new THREE.BufferGeometry();
      obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      obj.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      obj.visible = pts.length > 0;
    }
    this.needsRender = true;
  }

  private build() {
    const s = this.state!;
    const fr = (this.frames = computeFrames(s));
    const n = s.shoots.length;
    const year = yearOf(s.day), doy = doyOf(s.day);
    const { base, tip } = fr;
    const wb = this.wb, bb = this.bb, nb = this.nb;
    wb.reset(); bb.reset(); nb.reset();
    this.jointEnds = {}; this.jointGap = { rel: 0, parent: -1, child: -1, info: '' }; this.attachGap = 0;
    this.builtDist = this.dist;

    // pokračující výhon určuje poloměr na vrcholu a směr, kterým osa plynule navazuje
    const mainR = new Float32Array(n);
    const mainKid = new Int32Array(n).fill(-1);
    // kdo skutečně pokračuje v ose: živý terminál, jinak nejsilnější živá větev na vrcholu (po řezu vrcholu)
    const contKid = new Int32Array(n).fill(-1);
    const whorl = new Uint8Array(n); // počet bočních větví v přeslenu na vrcholu výhonu
    let H = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      if (sh.parent >= 0 && sh.attachT > 0.98) {
        const pi = fr.index.get(sh.parent)!;
        const r = radiusOf(sh);
        if (sh.isMain) mainKid[pi] = i; else if (!sh.dead) whorl[pi]++;
        if (!sh.dead || s.shoots[pi].dead) { // suchá větev navazuje na suchou
          const cur = contKid[pi];
          if (cur < 0 || (sh.isMain && !s.shoots[cur].isMain) || (sh.isMain === s.shoots[cur].isMain && r > radiusOf(s.shoots[cur]))) contKid[pi] = i;
        }
        if (sh.isMain || mainR[pi] === 0) mainR[pi] = Math.max(mainR[pi], sh.isMain ? r : r * 0.9);
      }
      if (!sh.dead) H = Math.max(H, tip[i * 3 + 1]);
      total += sh.needleCount * sh.needleLive * (speciesOf(s).kind === 'leafy' ? (speciesOf(s).leafShape === 'tuft' ? 4 : 2.2) : 1);
    }
    this.height = H;
    const stride = Math.max(1, Math.ceil(total / MAX_FASCICLES));
    const nw = Math.max(0.09, this.dist * 0.0011 * Math.pow(stride, 0.4));
    const sp = speciesOf(s), leafySp = sp.kind === 'leafy';
    const style = (['pine', 'larch', 'maple', 'oak', 'birch', 'beech', 'hornbeam'] as BarkStyle[]).find((x) => x === sp.id) ?? 'pine';
    if (style !== this.barkStyle) {
      this.barkStyle = style;
      const m = this.bark.material as THREE.MeshStandardMaterial;
      const useProcedural = () => {
        if (!this.barkCache.has(style)) this.barkCache.set(style, barkTexture(style));
        m.map = m.bumpMap = this.barkCache.get(style)!;
        m.normalMap = null;
        m.bumpScale = BARK_BUMP[style];
        this.photoU.value = 0;
        m.needsUpdate = true;
      };
      const usePhoto = (t: { d: THREE.Texture; n: THREE.Texture }) => {
        m.map = t.d; m.normalMap = t.n; m.bumpMap = null;
        m.normalScale.set(1.4, 1.4);
        this.photoU.value = 1;
        m.needsUpdate = true;
        this.needsRender = true;
      };
      // fotografická textura (assets/tex); dokud se nenačte, nebo když chybí, slouží kreslený vzor
      const file = style === 'larch' ? 'pine' : style;
      const cached = this.photoCache.get(file);
      if (cached) usePhoto(cached);
      else {
        useProcedural();
        if (cached === undefined) {
          this.photoCache.set(file, null);
          const loader = new THREE.TextureLoader();
          const prep = (t: THREE.Texture, srgb: boolean) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
          loader.load(`tex/${file}_d.jpg`, (d) => loader.load(`tex/${file}_n.jpg`, (nn) => {
            const t = { d: prep(d, true), n: prep(nn, false) };
            this.photoCache.set(file, t);
            const now = this.barkStyle === 'larch' ? 'pine' : this.barkStyle;
            if (now === file) usePhoto(t);
          }, undefined, () => undefined), undefined, () => undefined);
        }
      }
    }
    const budG = s.budSetYear === year ? 0.3 + 0.7 * smooth((s.gdd - s.budSetGdd) / P.budGrowGdd) : 1.1;
    const col = [0, 0, 0];
    const shedSeason = doy >= P.shedStartDoy && doy < P.shedEndDoy + 20;
    const R0 = n ? radiusOf(s.shoots[0]) : 0;
    const zone = 2.4 * R0 * smooth((R0 - 0.12) / 0.5);
    // Pata kmene: u země se kmen rozšiřuje do náběhů mířících do směrů povrchových kořenů, takže kořen
    // vybíhá z hřbetu kmene a ne z hladkého válce.
    const nebari = this.spreadPreview > 0 ? spreadNebari(s.nebari, this.spreadPreview) : s.nebari;
    const lobeOf = (x: number, z: number) => {
      const az = Math.atan2(z, x);
      let best = 0;
      for (const root of nebari) { const c = Math.cos(az - root.az); if (c > 0) best = Math.max(best, (root.thick / 0.45) * Math.pow(c, 12)); }
      return best;
    };
    // barva dřeva a síla borky každého výhonu; v kloubech se prolínají se sousedem, aby přechod nebyl skokem
    const C = new Float32Array(n * 3), BK = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      woodColor(s, sh, col);
      const ao = sh.dead ? 1 : 0.8 + 0.2 * sh.light;
      C[i * 3] = col[0] * ao; C[i * 3 + 1] = col[1] * ao; C[i * 3 + 2] = col[2] * ao;
      const ag = year - sh.bornYear;
      BK[i] = sh.dead || ag < 2 ? 0 : leafySp ? sp.barkRough * smooth((ag - sp.barkAge * 0.4) / sp.barkAge) : smooth((ag - 1.5) / 5) * (0.6 + 0.4 * smooth(radiusOf(sh) / 1.2));
    }
    const endTan = (sh: Shoot): Vec3 => (sh.arc ? rotate(sh.dir, sh.arc.axis, sh.arc.angle) : sh.dir);
    // Nástupce vrcholu nasazený níž na seříznutém úseku (zpětný pupen, výhon z pahýlu): úsek se kreslí jen
    // k němu a oba navazují společným prstencem, místo aby větev trčela z boku pahýlu s klínem u řezu.
    const TE = new Float32Array(n).fill(1);
    {
      // nejvzdálenější živá větev na každém seříznutém úseku bez pokračování na vrcholu
      const last = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        const c = s.shoots[i];
        if (c.dead || c.parent < 0 || c.attachT > 0.98) continue;
        const pi = fr.index.get(c.parent)!;
        if (!s.shoots[pi].tipCut || s.shoots[pi].dead || contKid[pi] >= 0) continue;
        if (last[pi] < 0 || c.attachT > s.shoots[last[pi]].attachT) last[pi] = i;
      }
      for (let pi = 0; pi < n; pi++) {
        const i = last[pi];
        if (i < 0) continue;
        const p = s.shoots[pi], c = s.shoots[i];
        // jen krátký konec za poslední větví „zaroste“; delší pahýl zůstává vidět a větev z něj roste do strany.
        // Žádná větev tak nikdy nezůstane za koncem nakresleného úseku.
        if ((1 - c.attachT) * p.len <= 4 * radiusOf(p) && c.attachT > 0.25) { contKid[pi] = i; TE[pi] = c.attachT; }
      }
    }
    const ONT = new Uint8Array(n);
    const MID = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const c = s.shoots[i]; if (c.parent >= 0 && c.attachT <= 0.98) MID[fr.index.get(c.parent)!] = 1; }
    const VO = new Float32Array(n).fill(-1);
    const UE = new Float32Array(n * 3); // osa u posledního prstence každého úseku
    const RNS = new Uint8Array(n); // počet vrcholů prstence; navazující úsek ho dědí
    // Společný prstenec ve spoji dvou navazujících úseků: leží v rovině půlící úhel mezi nimi a má jeden
    // poloměr, takže konec jednoho úseku a začátek druhého na sebe přesně dosednou (žádné mezery ani zářezy).
    const rEff = (j: number) => radiusOf(s.shoots[j]) * (s.shoots[j].elong && s.shoots[j].targetLen > 0 ? 0.55 + 0.45 * (s.shoots[j].len / s.shoots[j].targetLen) : 1);
    const jointDir = (pi: number, ci: number): Vec3 => { const a = endTan(s.shoots[pi]), b = s.shoots[ci].dir; return nrm(a[0] + b[0], a[1] + b[1], a[2] + b[2]); };
    const jointR = (pi: number, ci: number) => Math.min(rEff(pi), rEff(ci)) * (whorl[pi] > 0 && rEff(pi) > 0.15 ? 1.1 : 1);

    const nrm = (x: number, y: number, z: number): Vec3 => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const d0 = sh.dir;
      // osy průřezu volené tak, aby w = d × u – stěny trubky pak míří ven (jinak by se kreslil vnitřek)
      let [u0, wB] = basis(d0);
      {
        // navazující úsek přebírá natočení průřezu od předchozího: vrcholy prstenců ve spoji pak leží přesně na sobě
        const pq = sh.parent >= 0 ? fr.index.get(sh.parent)! : -1;
        if (pq >= 0 && contKid[pq] === i && UE[pq * 3] + UE[pq * 3 + 1] + UE[pq * 3 + 2] !== 0) {
          const k = UE[pq * 3] * d0[0] + UE[pq * 3 + 1] * d0[1] + UE[pq * 3 + 2] * d0[2];
          const x = UE[pq * 3] - d0[0] * k, y = UE[pq * 3 + 1] - d0[1] * k, z = UE[pq * 3 + 2] - d0[2] * k;
          if (Math.hypot(x, y, z) > 0.2) { u0 = nrm(x, y, z); wB = [-(d0[1] * u0[2] - d0[2] * u0[1]), -(d0[2] * u0[0] - d0[0] * u0[2]), -(d0[0] * u0[1] - d0[1] * u0[0])]; }
        }
      }
      const w0: Vec3 = [-wB[0], -wB[1], -wB[2]];
      const len = sh.len;
      const arc = sh.arc;
      const age = year - sh.bornYear;

      // Hladké napojení: v kloubu mezi výhonem a jeho pokračováním má osa společnou tečnu (Hermitova křivka),
      // takže kmen neroste po zalomených tyčkách. Koncové body zůstávají tam, kde je má simulace.
      let T0: Vec3 = d0, T1: Vec3 = d0;
      if (!arc) {
        if (sh.parent >= 0 && contKid[fr.index.get(sh.parent)!] === i) {
          const pe = endTan(s.shoots[fr.index.get(sh.parent)!]);
          T0 = nrm(pe[0] + d0[0], pe[1] + d0[1], pe[2] + d0[2]);
        }
        const kc = contKid[i] >= 0 ? contKid[i] : mainKid[i];
        if (kc >= 0) { const c = s.shoots[kc].dir; T1 = nrm(d0[0] + c[0], d0[1] + c[1], d0[2] + c[2]); }
        // krátký silný úsek se ohnout nedá – prstence by se překlopily přes sebe a vznikly by ostré hrany
        const soft = clamp(len / (7 * radiusOf(sh) + 0.01) - 0.15, 0, 1);
        T0 = nrm(d0[0] + (T0[0] - d0[0]) * soft, d0[1] + (T0[1] - d0[1]) * soft, d0[2] + (T0[2] - d0[2]) * soft);
        T1 = nrm(d0[0] + (T1[0] - d0[0]) * soft, d0[1] + (T1[1] - d0[1]) * soft, d0[2] + (T1[2] - d0[2]) * soft);
      }
      const dot0 = T0[0] * d0[0] + T0[1] * d0[1] + T0[2] * d0[2], dot1 = T1[0] * d0[0] + T1[1] * d0[1] + T1[2] * d0[2];
      // výhon, ze kterého uprostřed délky roste jiný výhon, se kreslí rovně: potomek sedí na přímé spojnici
      // a na prohnuté křivce by visel vedle ní
      if (MID[i] && !arc && TE[i] === 1 && len > 0.05 && (dot0 < 0.9995 || dot1 < 0.9995)) {
        // o kolik by se prohnutá osa uprostřed odchýlila od přímé spojnice (v poloměrech výhonu) – jen pro kontrolu
        const dv = (len / 8) * Math.hypot(T0[0] - T1[0], T0[1] - T1[1], T0[2] - T1[2]) / Math.max(0.03, radiusOf(sh));
        if (dv > this.attachGap) this.attachGap = dv;
      }
      const curved = !arc && TE[i] === 1 && !MID[i] && len > 0.05 && (dot0 < 0.9995 || dot1 < 0.9995);

      // místní soustava v bodě t výhonu: střed c a osy d (podél), u, w (napříč)
      let d: Vec3 = d0, u: Vec3 = u0, w: Vec3 = w0, cx = bx, cy = by, cz = bz;
      const at = (t: number) => {
        if (arc) {
          const p = shootPoint(sh, t), a = arc.angle * Math.min(1, t / Math.max(arc.z, 1e-3));
          cx = bx + p[0]; cy = by + p[1]; cz = bz + p[2];
          d = rotate(d0, arc.axis, a); u = rotate(u0, arc.axis, a); w = rotate(w0, arc.axis, a);
        } else if (curved) {
          const t2 = t * t, t3 = t2 * t;
          const h1 = t3 - 2 * t2 + t, h2 = -2 * t3 + 3 * t2, h3 = t3 - t2;
          cx = bx + len * (h1 * T0[0] + h2 * d0[0] + h3 * T1[0]);
          cy = by + len * (h1 * T0[1] + h2 * d0[1] + h3 * T1[1]);
          cz = bz + len * (h1 * T0[2] + h2 * d0[2] + h3 * T1[2]);
          const g1 = 3 * t2 - 4 * t + 1, g2 = -6 * t2 + 6 * t, g3 = 3 * t2 - 2 * t;
          d = nrm(g1 * T0[0] + g2 * d0[0] + g3 * T1[0], g1 * T0[1] + g2 * d0[1] + g3 * T1[1], g1 * T0[2] + g2 * d0[2] + g3 * T1[2]);
          const k = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
          u = nrm(u[0] - d[0] * k, u[1] - d[1] * k, u[2] - d[2] * k);
          w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
        } else { cx = bx + d0[0] * len * t; cy = by + d0[1] * len * t; cz = bz + d0[2] * len * t; }
      };

      let rb = radiusOf(sh);
      if (sh.elong && sh.targetLen > 0) rb *= 0.55 + 0.45 * (len / sh.targetLen);
      const ck = contKid[i];
      const ckTip = ck >= 0; // pokračování osy (na vrcholu, nebo nástupce níž na pahýlu – pak se úsek kreslí jen k němu)
      const stump = sh.tipCut && !sh.elong && !ckTip && year > sh.bornYear;
      const rt = sh.dead && !ckTip ? rb * 0.6 : stump ? rb * 0.94 : ckTip ? Math.min(rb, radiusOf(s.shoots[ck]) * (s.shoots[ck].elong && s.shoots[ck].targetLen > 0 ? 0.55 + 0.45 * (s.shoots[ck].len / s.shoots[ck].targetLen) : 1)) : mainR[i] > 0 ? Math.min(rb, mainR[i]) : rb * 0.72;
      col[0] = C[i * 3]; col[1] = C[i * 3 + 1]; col[2] = C[i * 3 + 2];
      // sousedé v ose: úsek, na který navazuji, a úsek, který navazuje na mě
      const pIdx = sh.parent >= 0 ? fr.index.get(sh.parent)! : -1;
      const isCont = pIdx >= 0 && contKid[pIdx] === i; // pokračuji v ose rodiče
      const pj = pIdx >= 0 && !sh.dead && !s.shoots[pIdx].dead ? pIdx : -1;
      const kj = sh.dead ? -1 : contKid[i];
      const mixAt = (t: number, own: number, a: number, b: number) => {
        // v kloubu průměr obou úseků; boční větev přechází do vlastní barvy o něco rychleji
        const lo = pj < 0 ? own : (own + a) / 2, span = isCont ? 0.5 : 0.4;
        const hi = kj >= 0 ? (own + b) / 2 : own;
        return t < span ? lo + (own - lo) * smooth(t / span) : t > 0.5 ? own + (hi - own) * smooth(t * 2 - 1) : own;
      };
      const colorAt = (t: number, ch: number) => mixAt(t, col[ch], pj >= 0 ? C[pj * 3 + ch] : 0, kj >= 0 ? C[kj * 3 + ch] : 0);
      const barkAt = (t: number) => mixAt(t, BK[i], pj >= 0 ? BK[pj] : 0, kj >= 0 ? BK[kj] : 0);
      // kořenové náběhy u země a límec v nasazení větve
      // kmen = řetěz navazujících úseků od paty (včetně větve, která převzala vrchol); jen ten má náběhy,
      // a obě strany každého spoje tak dostanou stejné rozšíření
      const onTrunk = i === 0 || (sh.parent >= 0 && ONT[fr.index.get(sh.parent)!] === 1 && contKid[fr.index.get(sh.parent)!] === i);
      if (onTrunk) ONT[i] = 1;
      // rozšíření řídí jen výška bodu nad zemí (ne výška paty úseku), aby se obě strany spoje shodly
      const inZone = onTrunk && zone > 0.2;
      const par = sh.parent >= 0 ? s.shoots[fr.index.get(sh.parent)!] : null;
      // límec v nasazení boční větve: rozšíření, které je protažené podél mateřské osy (jako u skutečné větve)
      // límec jen u skutečné boční větve; větev, která převzala osu, navazuje spojem a límec by spoj roztrhl
      const collar = par && !sh.isMain && rb > 0.1 && len > 0 && contKid[fr.index.get(sh.parent)!] !== i;
      const pd: Vec3 = par ? endTan(par) : d0;
      const rp = par ? radiusOf(par) * (sh.attachT > 0.98 ? 0.75 : 1) : 0;
      const tc = collar ? Math.min(0.6, (rp * 1.2 + 2.6 * rb) / len) : 0;
      // ztluštění v přeslenu: kmen je v místě nasazení větví mírně naběhlý
      const swellTip = whorl[i] > 0 && rb > 0.15, swellBase = !!par && sh.isMain && sh.attachT > 0.98 && whorl[fr.index.get(sh.parent)!] > 0 && rb > 0.15;
      const radiusAt = (t: number) => {
        let r = rt < rb * 0.7 ? rt + (rb - rt) * (1 - Math.pow(t, 2.4)) : rb + (rt - rb) * t;
        if (collar && t < tc) r *= 1 + 0.45 * (1 - t / tc) * (1 - t / tc);
        if (swellTip) { const x = ((1 - t) * len) / (1.4 * rt + 0.05); r *= 1 + 0.13 * Math.exp(-x * x); }
        if (swellBase) { const x = (t * len) / (1.4 * rb + 0.05); r *= 1 + 0.13 * Math.exp(-x * x); }
        return r;
      };

      if (len > 0.01) {
        const isBark = BK[i] > 0;
        const B = bb; // všechno dřevo v jedné síti – hladké i rozpraskané se liší jen sílou borky ve vrcholech
        const RN = pIdx >= 0 && contKid[pIdx] === i && RNS[pIdx] ? RNS[pIdx] : i === 0 && zone > 0.2 ? 20 : rb < 0.25 ? 6 : rb < 0.8 ? 8 : rb < 2 ? 12 : 16;
        RNS[i] = RN;
        void 0;
        const ts: number[] = [0];
        if (collar && tc > 0.02) ts.push(tc * 0.2, tc * 0.45, tc * 0.7, tc);
        if (inZone && by < zone) ts.push(0.15, 0.3, 0.5, 0.75);
        if (swellTip) ts.push(1 - Math.min(0.3, (1.5 * rt) / len), 1 - Math.min(0.15, (0.7 * rt) / len));
        if (swellBase) ts.push(Math.min(0.15, (0.7 * rb) / len), Math.min(0.3, (1.5 * rb) / len));
        ts.sort((a, b) => a - b);
        const turn = arc ? Math.abs(arc.angle) : curved ? Math.acos(clamp(T0[0] * T1[0] + T0[1] * T1[1] + T0[2] * T1[2], -1, 1)) : 0;
        const seg = arc ? clamp(Math.round(turn * 10), 4, 16) : curved ? clamp(Math.ceil(turn * 8) + 2, 3, 8) : 1;
        for (let k = 1; k <= seg; k++) ts.push(k / seg);
        ts.sort((a, b) => a - b);
        {
          const keep = [0];
          for (const t of ts) if (t - keep[keep.length - 1] >= 0.02 && 1 - t >= 0.02) keep.push(t);
          keep.push(1);
          ts.length = 0; ts.push(...keep);
        }
        {
          // u ostrého spoje nesmí být další prstenec moc blízko – šikmý společný prstenec by ho na vnitřní straně
          // ohybu protnul a vznikl by cíp
          const guard = (jd: Vec3, tan: Vec3, r: number) => {
            const c = clamp(jd[0] * tan[0] + jd[1] * tan[1] + jd[2] * tan[2], 0.2, 1);
            return (r * (Math.sqrt(1 - c * c) / c + 0.35)) / len;
          };
          const g0 = pIdx >= 0 && contKid[pIdx] === i ? guard(jointDir(pIdx, i), d0, jointR(pIdx, i)) : 0;
          const g1 = ckTip ? guard(jointDir(i, ck), endTan(sh), jointR(i, ck)) : 0;
          const kept = ts.filter((t) => t === 0 || t === 1 || (t > g0 && t < 1 - g1));
          ts.length = 0; ts.push(...kept);
          // kmen pokračuje pod povrch substrátu, aby u šikmo posazeného stromu nebyl vidět jeho rovný konec
          if (i === 0 && zone > 0.2) { const tb = Math.min(1.5, (1.6 * rb) / len); ts.unshift(-tb, -tb * 0.45); }
        }
        const rough = isBark ? clamp((rb - 0.3) * 0.05, 0, 0.07) : 0;
        const tile = 2.4 + rb * 1.8; // silnější kmen má větší desky
        const tiles = Math.max(1, Math.round((6.2832 * rb) / tile));
        const v0 = VO[i] >= 0 ? VO[i] : (sh.id % 7) * 0.13;
        if (ck >= 0) VO[ck] = v0 + len / (tile * 2); // kresba kůry pokračuje do navazujícího úseku
        B.reserve(ts.length * (RN + 1) + 1, ts.length * RN * 6);
        let prev = -1;
        for (let q = 0; q < ts.length; q++) {
          const t = ts[q];
          at(t * TE[i]);
          let r = radiusAt(t);
          const jStart = q === 0 && pIdx >= 0 && contKid[pIdx] === i && ts[0] === 0;
          const jEnd = q === ts.length - 1 && ckTip;
          if (jStart || jEnd) {
            const J = jStart ? jointDir(pIdx, i) : jointDir(i, ck);
            r = jStart ? jointR(pIdx, i) : jointR(i, ck);
            // začátek navazujícího úseku použije přesně tutéž osu u, jakou měl konec předchozího
            const src: Vec3 = jStart && UE[pIdx * 3] + UE[pIdx * 3 + 1] + UE[pIdx * 3 + 2] !== 0 ? [UE[pIdx * 3], UE[pIdx * 3 + 1], UE[pIdx * 3 + 2]] : u;
            const kk = src[0] * J[0] + src[1] * J[1] + src[2] * J[2];
            d = J; u = nrm(src[0] - J[0] * kk, src[1] - J[1] * kk, src[2] - J[2] * kk);
            w = [J[1] * u[2] - J[2] * u[1], J[2] * u[0] - J[0] * u[2], J[0] * u[1] - J[1] * u[0]];
          }
          // Pokosový řez: průřez válce šikmou rovinou je elipsa. Prstenec ve spoji se proto v rovině ohybu
          // protáhne o 1/cos(polovina úhlu) – jinak by se kmen v ostrém ohybu přiškrtil a rohy by trčely.
          let mx = 0, my = 0, mz = 0, mk = 0;
          if (jStart || jEnd) {
            const a = jStart ? d0 : endTan(sh); // směr tohoto úseku u spoje
            // směr protažení z nezkrácené hodnoty (musí být přesně kolmý na rovinu spoje a na obou stranách
            // spoje stejný); omezuje se jen velikost protažení u extrémně ostrých ohybů
            const c = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
            const ex = a[0] - d[0] * c, ey = a[1] - d[1] * c, ez = a[2] - d[2] * c, el = Math.hypot(ex, ey, ez);
            if (el > 1e-3 && c < 0.999) { mx = ex / el; my = ey / el; mz = ez / el; mk = 1 / Math.max(0.42, c) - 1; }
          }
          if (q === ts.length - 1) { UE[i * 3] = u[0]; UE[i * 3 + 1] = u[1]; UE[i * 3 + 2] = u[2]; }
          // boční větev nesmí být u nasazení silnější než mateřský úsek, jinak by z něj na druhé straně trčela
          const sideBase = q === 0 && pIdx >= 0 && !jStart;
          if (sideBase) r = Math.min(r, rEff(pIdx) * 0.92);
          const stretch = collar && t < tc ? 0.3 * (1 - t / tc) * (1 - t / tc) : 0;
          let c0 = colorAt(t, 0), c1 = colorAt(t, 1), c2 = colorAt(t, 2);
          const bk = barkAt(t);
          if (leafySp && age === 0 && !sh.dead && sh.kind === 'shoot') {
            // letorost dřevnatí od báze: špička zůstává přes léto zelená, na podzim celý zhnědne
            const gk = 0.85 * smooth(t * 1.4 - 0.1) * (1 - smooth((s.gdd - 900) / 900));
            c0 += (0.4 - c0) * gk; c1 += (0.52 - c1) * gk; c2 += (0.24 - c2) * gk;
          } else if (!sh.dead && bk < 0.3) {
            // mladé dřevo je na osluněné straně teplejší, na spodní tmavší
            const k = 0.9 + 0.2 * rnd(sh.id, q, 31);
            c0 *= k; c1 *= k; c2 *= k;
          }
          const first = B.nv;
          for (let k = 0; k <= RN; k++) {
            const a = (k / RN) * 6.2832, km = k % RN;
            const nx = u[0] * Math.cos(a) + w[0] * Math.sin(a), ny = u[1] * Math.cos(a) + w[1] * Math.sin(a), nz = u[2] * Math.cos(a) + w[2] * Math.sin(a);
            const rr = r * (1 + (jStart || jEnd ? 0 : rough) * (rnd(sh.id, km, q + 20) - 0.5) * 2); // ve spoji bez nerovností, aby prstence splynuly
            // protažení límce podél mateřské osy
            const al = stretch ? (nx * pd[0] + ny * pd[1] + nz * pd[2]) * rr * stretch : 0;
            const ml = mk ? (nx * mx + ny * my + nz * mz) * rr * mk : 0;
            let vx = cx + nx * rr + pd[0] * al + mx * ml, vz = cz + nz * rr + pd[2] * al + mz * ml;
            const vy = cy + ny * rr + pd[1] * al + my * ml;
            if (inZone && vy < zone) {
              // Nebari: rozšíření je vodorovné (i u šikmého kmene) a vyduté jako ústí trubky – kmen se dlouho
              // skoro nemění a rozběhne se až těsně nad zemí. Řídí se výškou samotného bodu, takže spoje sedí.
              const ox = vx - cx, oz = vz - cz, ol = Math.hypot(ox, oz);
              if (ol > 1e-4) {
                const f = clamp(1 - vy / zone, 0, 1.15);
                // pod povrchem substrátu se rozšíření zase stahuje, aby u kraje misky neprošlo její stěnou
                const under = vy < 0 ? Math.max(0, 1 + vy / (0.8 * R0)) : 1, fc = Math.min(1, f);
                const push = R0 * under * (0.3 * Math.pow(fc, 3) + 1.5 * Math.pow(fc, 5) * lobeOf(ox, oz));
                vx += (ox / ol) * push; vz += (oz / ol) * push;
              }
            }
            B.v(vx, vy, vz, nx, ny, nz, c0, c1, c2);
            B.t((k / RN) * tiles, v0 + (t * len) / (tile * 2), bk);
            if (jEnd || jStart) {
              // kontrola spojů: konec úseku a začátek navazujícího musí mít totožné vrcholy
              const o = (B.nv - 1) * 3, key = jEnd ? i : pIdx;
              if (jEnd) { (this.jointEnds[key] ??= []).push(B.pos[o], B.pos[o + 1], B.pos[o + 2]); }
              else { const e = this.jointEnds[key]; const g = e && e.length > k * 3 + 2 ? Math.hypot(e[k * 3] - B.pos[o], e[k * 3 + 1] - B.pos[o + 1], e[k * 3 + 2] - B.pos[o + 2]) : 99; if (g / Math.max(0.05, r) > this.jointGap.rel) this.jointGap = { rel: g / Math.max(0.05, r), parent: s.shoots[pIdx].id, child: sh.id, info: `RN ${RN}/${RNS[pIdx]} verts ${e ? e.length / 3 : -1} TEp ${TE[pIdx]} aT ${sh.attachT} arcP ${!!s.shoots[pIdx].arc} arcC ${!!arc}` }; }
            }
          }
          if (q === 0 && pIdx >= 0 && !jStart) {
            // uzavřený začátek boční větve
            B.reserve(1, RN * 3);
            const cc = B.v(cx - d[0] * r * 0.3, cy - d[1] * r * 0.3, cz - d[2] * r * 0.3, -d[0], -d[1], -d[2], c0, c1, c2);
            B.t(0.5, v0, bk);
            for (let k = 0; k < RN; k++) B.tri(first + k + 1, first + k, cc);
          }
          if (prev >= 0) for (let k = 0; k < RN; k++) {
            B.tri(prev + k, prev + k + 1, first + k); B.tri(prev + k + 1, first + k + 1, first + k);
          }
          prev = first;
        }
        // světlá řezná plocha jen tam, kde výhon opravdu končí řezem; zaštípnutý výhon, ze kterého osa pokračuje, ji nemá
        const bareCut = sh.tipCut && !ckTip;
        const cut = ckTip ? 0 : stump ? 0.04 : bareCut && !sh.elong ? 0.2 : 0.8;
        const c = B.v(cx + d[0] * rt * cut, cy + d[1] * rt * cut, cz + d[2] * rt * cut, d[0], d[1], d[2],
          bareCut ? 0.8 : colorAt(1, 0), bareCut ? 0.7 : colorAt(1, 1), bareCut ? 0.5 : colorAt(1, 2));
        B.t(0.5, v0 + len / (tile * 2), bareCut ? 0 : barkAt(1));
        for (let k = 0; k < RN; k++) B.tri(prev + k, prev + k + 1, c);
      }

      if ((sh.wire || sh.scar) && len > 0.3) {
        // drát: měděná šroubovice o síle ~1/3 větve; po zarostlém drátu zůstane tmavá jizva
        const wr = sh.wire ? Math.max(0.035, rb / 3) : 0.02;
        const pitch = Math.max(0.5, rb * 4 + wr * 2);
        const steps = Math.min(240, Math.max(8, Math.round((len / pitch) * 8)));
        const [cr, cg, cb] = sh.wire ? (sh.scar ? [0.42, 0.26, 0.16] : [0.6, 0.36, 0.2]) : [0.3, 0.23, 0.19];
        wb.reserve((steps + 1) * 2, steps * 12);
        let prev = -1;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, a = (k / 8) * 6.2832 + sh.id;
          at(t);
          const rr = radiusAt(t) * (sh.wire && !sh.scar ? 1 : 1.03) + (sh.wire && !sh.scar ? wr * 0.7 : 0.025);
          const nx = u[0] * Math.cos(a) + w[0] * Math.sin(a), ny = u[1] * Math.cos(a) + w[1] * Math.sin(a), nz = u[2] * Math.cos(a) + w[2] * Math.sin(a);
          const px = cx + nx * rr, py = cy + ny * rr, pz = cz + nz * rr;
          const hw2 = wr * 0.55; // drát je tenký proužek, ne široký pás
          const v0 = wb.v(px - d[0] * hw2, py - d[1] * hw2, pz - d[2] * hw2, nx, ny, nz, cr, cg, cb);
          wb.v(px + d[0] * hw2, py + d[1] * hw2, pz + d[2] * hw2, nx, ny, nz, cr, cg, cb);
          if (prev >= 0) {
            wb.tri(prev, prev + 1, v0); wb.tri(prev + 1, v0 + 1, v0);
            wb.tri(prev, v0, prev + 1); wb.tri(prev + 1, v0, v0 + 1);
          }
          prev = v0;
        }
      }

      if (sh.dead) continue;

      // pupeny: vejčité, červenohnědé, se světlou zasmolenou špičkou
      const drawBud = (dir: Vec3, bl: number, off: number, fat = 0.3, tint: number[] | null = null) => {
        const br = bl * fat;
        const ox = cx + dir[0] * off, oy = cy + dir[1] * off, oz = cz + dir[2] * off;
        const [bu, bwB] = basis(dir);
        const bw: Vec3 = [-bwB[0], -bwB[1], -bwB[2]];
        wb.reserve(3 * RAD + 1, 3 * RAD * 6);
        let prev = -1;
        for (const [t, r, cr, cg, cb] of [[0, 0.7, 0.5, 0.3, 0.2], [0.4, 1, 0.62, 0.36, 0.24], [0.78, 0.55, 0.7, 0.5, 0.36]] as number[][]) {
          const first = wb.nv;
          for (let k = 0; k < RAD; k++) {
            const a = (k / RAD) * 6.2832;
            const nx = bu[0] * Math.cos(a) + bw[0] * Math.sin(a), ny = bu[1] * Math.cos(a) + bw[1] * Math.sin(a), nz = bu[2] * Math.cos(a) + bw[2] * Math.sin(a);
            const sh2 = tint ? 0.75 + 0.3 * t : 1;
            wb.v(ox + dir[0] * bl * t + nx * br * r, oy + dir[1] * bl * t + ny * br * r, oz + dir[2] * bl * t + nz * br * r, nx, ny, nz, tint ? tint[0] * sh2 : cr, tint ? tint[1] * sh2 : cg, tint ? tint[2] * sh2 : cb);
          }
          if (prev >= 0) for (let k = 0; k < RAD; k++) {
            const k2 = (k + 1) % RAD;
            wb.tri(prev + k, prev + k2, first + k); wb.tri(prev + k2, first + k2, first + k);
          }
          prev = first;
        }
        const c = wb.v(ox + dir[0] * bl, oy + dir[1] * bl, oz + dir[2] * bl, dir[0], dir[1], dir[2], tint ? tint[0] : 0.82, tint ? tint[1] : 0.7, tint ? tint[2] : 0.55);
        for (let k = 0; k < RAD; k++) wb.tri(prev + k, prev + (k + 1) % RAD, c);
      };
      // samčí šištice: žluté shluky na holé bázi letorostu, v květnu–červnu práší, pak zhnědnou a opadají
      if (sh.male && age === 0 && s.gdd > 150 && doy < P.shedStartDoy && len > 0.3) {
        const fresh = s.gdd < 750;
        const size = (fresh ? 0.5 : 0.36) * smooth((s.gdd - 150) / 200);
        for (let k = 0; k < 9; k++) {
          const t = 0.01 + 0.085 * (k / 9), a = k * 2.4 + sh.id;
          at(t);
          const dir = nrm(u[0] * Math.cos(a) + w[0] * Math.sin(a) + d[0] * 0.4, u[1] * Math.cos(a) + w[1] * Math.sin(a) + d[1] * 0.4, u[2] * Math.cos(a) + w[2] * Math.sin(a) + d[2] * 0.4);
          drawBud(dir, size, rb * 0.7, 0.42, fresh ? [0.86, 0.74, 0.3] : [0.5, 0.36, 0.22]);
        }
      }
      // samičí šiška: 1. rok drobná načervenalá u vrcholu, 2. rok zelená a roste, 3. rok hnědá a otevřená, pak opadne
      if (sh.cone && age <= 2 && !sh.elong && (age > 0 || s.gdd > 500)) {
        at(0.93);
        const a = sh.id * 1.7;
        const side: Vec3 = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
        const season = smooth(s.gdd / 1400);
        if (age === 0) drawBud(nrm(side[0] + d[0], side[1] + d[1], side[2] + d[2]), 0.7, rb * 0.6, 0.4, [0.62, 0.3, 0.34]);
        else if (age === 1) drawBud(nrm(side[0], side[1] - 0.5 * season, side[2]), 1 + 3 * season, rb * 0.6, 0.36, [0.36, 0.5, 0.28]);
        else drawBud(nrm(side[0], side[1] - 0.8, side[2]), 4.3, rb * 0.6, 0.46, [0.47, 0.34, 0.22]);
      }
      for (const b of sh.buds) {
        at(b.t);
        if (leafySp) drawBud(b.dir, sp.budLen * (0.7 + 0.03 * Math.min(20, b.len)) * budG, b.t > 0.98 && b.isMain ? 0 : rb * 0.6, sp.budFat, sp.budColor);
        else drawBud(b.dir, Math.min(1.5, 0.28 + 0.045 * b.len) * budG, b.kind === 'terminal' || b.t < 0.98 ? 0 : rt * 0.5);
      }
      // rašící svíčka: pupen nezmizí, ale protahuje se – na špičce svíčky zůstává, dokud nedoroste
      if (!leafySp && sh.elong && sh.kind === 'shoot' && !sh.tipCut) {
        const e = sh.targetLen > 0 ? len / sh.targetLen : 1;
        at(1);
        drawBud(d, Math.min(1.5, 0.28 + 0.045 * sh.targetLen) * (1.1 - 0.75 * e), 0);
      }

      if (leafySp && !sh.dead) {
        // rašící letorost: pupen na špičce se s růstem výhonu postupně vytrácí (jako svíčka borovice)
        if (sh.elong && sh.kind === 'shoot' && !sh.tipCut) {
          const e = sh.targetLen > 0 ? len / sh.targetLen : 1;
          at(1);
          drawBud(d, sp.budLen * (1.15 - 0.95 * e), 0, sp.budFat, sp.budColor);
        }
        // modřín: krátké výhony jsou na starším dřevě vidět celý rok jako pupenovité čípky; z nich na jaře
        // vyrážejí svazečky jehlic
        if (sp.leafShape === 'tuft' && age >= 1 && sh.needleCount > 0) {
          const cntS = sh.needleCount, stepS = Math.max(1, stride);
          for (let k = (sh.id * 7) % stepS; k < cntS; k += stepS) {
            at(0.08 + 0.9 * ((k + 0.5) / cntS));
            const a2 = k * 2.39996 + sh.id;
            drawBud([u[0] * Math.cos(a2) + w[0] * Math.sin(a2), u[1] * Math.cos(a2) + w[1] * Math.sin(a2), u[2] * Math.cos(a2) + w[2] * Math.sin(a2)], 0.2, rb * 0.75, 0.55, sp.budColor);
          }
        }
      }
      if (sh.needleCount <= 0 || sh.needleLive <= 0) continue;
      if (leafySp) {
        // ---- listy (a jehlice modřínu): každé jaro nové, na podzim se barví a opadají
        const g = needleGrowth(s, sh);
        if (g < 0.04) continue;
        const winter = doy >= sp.fallDoy - 2 || s.gdd < sp.flushGdd;
        const fall = winter ? 1 : smooth((doy - (sp.colorDoy - 10)) / 22);
        // Stáří jednotlivého listu: na rostoucím výhonu jsou listy u špičky nejmladší. Rozvíjející se list je
        // malý a má barvu rašení (u habru, dubu a javoru bronzovou), pak je světle žlutozelený a do léta tmavne.
        const longShoot = sh.kind === 'shoot' && sh.bornYear === year;
        const aBase = sh.kind !== 'shoot' ? g * 3 : (s.gdd - sp.flushGdd - (longShoot ? sh.delay : 0)) / sp.leafSpanGdd;
        const lag = longShoot ? (sp.elongSpanGdd / sp.leafSpanGdd) * 0.75 : 0;
        const tone = [0, 0, 0];
        const setTone = (a: number) => {
          if (winter) { tone[0] = 0.46; tone[1] = 0.31; tone[2] = 0.18; return; }
          const k1 = smooth(a / 0.45), k2 = smooth((a - 0.9) / 2.4);
          for (let q = 0; q < 3; q++) {
            const young = sp.flushColor[q] + (sp.springColor[q] - sp.flushColor[q]) * k1;
            const c = young + (sp.leafColor[q] - young) * k2;
            tone[q] = c + (sp.autumnColor[q] - c) * fall;
          }
        };
        const cnt = sh.needleCount;
        let L0 = sh.needleLen;
        const shade = 0.62 + 0.38 * sh.light;
        const cur = sh.bornYear === year || sh.kind !== 'shoot';
        const cot = sh.kind === 'hypocotyl';
        const flat = sp.phyllotaxis === 'distichous' && Math.abs(d0[1]) < 0.86;
        const emit = (px: number, py: number, pz: number, ld: Vec3, L: number, k: number) => {
          const j = (0.85 + 0.3 * rnd(sh.id, k, 12)) * shade;
          // čepel v atlasu je šedá (kresba žilek je světlejší), proto se barva listu zesvětluje
          const lift2 = sp.leafShape === 'tuft' ? 1 : 1.9;
          const r = Math.min(1, tone[0] * j * lift2), gg = Math.min(1, tone[1] * j * lift2), b = Math.min(1, tone[2] * j * lift2);
          if (sp.leafShape === 'tuft') {
            // modřín: jehlice jako úzký trojúhelník
            const sx = ld[1] * 0 - ld[2], sz = ld[0], sl = Math.hypot(sx, sz) || 1;
            const hw = nw * 0.8;
            const i0 = nb.v(px - (sx / sl) * hw, py, pz - (sz / sl) * hw, 0, 1, 0, r * 0.75, gg * 0.75, b * 0.75); nb.t(0, 0, 0);
            nb.v(px + (sx / sl) * hw, py, pz + (sz / sl) * hw, 0, 1, 0, r * 0.75, gg * 0.75, b * 0.75); nb.t(0, 0, 0);
            nb.v(px + ld[0] * L, py + ld[1] * L, pz + ld[2] * L, 0, 1, 0, r * 1.15, gg * 1.15, b * 1.1); nb.t(0, 0, 1);
            nb.tri(i0, i0 + 1, i0 + 2); nb.tri(i0, i0 + 2, i0 + 1);
            return;
          }
          // čepel leží zhruba vodorovně, lícem vzhůru; okraje jsou lehce zvednuté podél střední žilky
          let sx = -ld[2], sz = ld[0];
          const sl = Math.hypot(sx, sz);
          if (sl < 0.2) { sx = u[0]; sz = u[2]; } else { sx /= sl; sz /= sl; }
          const nx = -sz * ld[1], ny = sz * ld[0] - sx * ld[2], nz = sx * ld[1]; // normála = šířka × délka
          const nl2 = Math.hypot(nx, ny, nz) || 1, ux = nx / nl2, uy = Math.abs(ny / nl2), uz = nz / nl2;
          const W = L * sp.leafWidth;
          const variants = this.leafGrid.cells[cot ? 'ovate' : sp.leafShape];
          const cell = variants[Math.floor(rnd(sh.id, k, 25) * variants.length) % variants.length];
          const GC = this.leafGrid.cols, GR = this.leafGrid.rows;
          const pet = L * 0.2;
          // čepel = 2 × 2 políčka; každý list je jinak natočený kolem řapíku, jinak prohnutý a zrcadlený
          {
            // řapík: úzký proužek od větvičky k čepeli (bílá buňka atlasu)
            const GC = this.leafGrid.cols, GR = this.leafGrid.rows;
            const pw = Math.max(0.02, W * 0.018), pr = r * 0.42, pg = gg * 0.45, pb = b * 0.3;
            const q0 = nb.v(px - sx * pw, py, pz - sz * pw, ux, uy, uz, pr, pg, pb); nb.t(0.5 / GC, 0.5 / GR, 0);
            nb.v(px + sx * pw, py, pz + sz * pw, ux, uy, uz, pr, pg, pb); nb.t(0.5 / GC, 0.5 / GR, 0);
            nb.v(px + ld[0] * pet * 1.15 - sx * pw, py + ld[1] * pet * 1.15, pz + ld[2] * pet * 1.15 - sz * pw, ux, uy, uz, pr, pg, pb); nb.t(0.5 / GC, 0.5 / GR, 0);
            nb.v(px + ld[0] * pet * 1.15 + sx * pw, py + ld[1] * pet * 1.15, pz + ld[2] * pet * 1.15 + sz * pw, ux, uy, uz, pr, pg, pb); nb.t(0.5 / GC, 0.5 / GR, 0);
            nb.tri(q0, q0 + 1, q0 + 3); nb.tri(q0, q0 + 3, q0 + 2); nb.tri(q0, q0 + 3, q0 + 1); nb.tri(q0, q0 + 2, q0 + 3);
          }
          const roll = (rnd(sh.id, k, 21) - 0.5) * (flat ? 0.35 : 0.9), curl = (rnd(sh.id, k, 22) - 0.35) * 0.3, flip = rnd(sh.id, k, 23) < 0.5 ? -1 : 1;
          const cr2 = Math.cos(roll), sr2 = Math.sin(roll);
          const ax = sx * cr2 + ux * sr2, ay = uy * sr2, az2 = sz * cr2 + uz * sr2; // osa šířky po natočení
          const bxn = ux * cr2 - sx * sr2, byn = uy * cr2, bzn = uz * cr2 - sz * sr2; // normála po natočení
          const skew = (rnd(sh.id, k, 24) - 0.5) * 0.12;
          let row0 = -1;
          for (let yi = 0; yi <= 2; yi++) for (let xx = -1; xx <= 1; xx++) {
            const yy = yi / 2, x = xx * 0.5;
            const lift = Math.abs(x) * W * 0.22 - curl * L * yy * yy;
            const v = nb.v(px + ld[0] * (pet + L * yy) + ax * W * (x + skew * yy) + bxn * lift, py + ld[1] * (pet + L * yy) + ay * W * x + byn * lift, pz + ld[2] * (pet + L * yy) + az2 * W * (x + skew * yy) + bzn * lift,
              bxn + ax * x * 0.5, Math.abs(byn) + 0.15, bzn + az2 * x * 0.5, r, gg, b);
            nb.t((cell[0] + 0.5 + flip * x * 0.94) / GC, (cell[1] + 0.03 + yy * 0.94) / GR, yy);
            if (row0 < 0) row0 = v;
          }
          for (let yi = 0; yi < 2; yi++) for (let q = 0; q < 2; q++) {
            const a0 = row0 + yi * 3 + q, a1 = a0 + 1, b0 = a0 + 3, b1 = a0 + 4;
            nb.tri(a0, a1, b1); nb.tri(a0, b1, b0); nb.tri(a0, b1, a1); nb.tri(a0, b0, b1);
          }
        };
        const tuft = sp.leafShape === 'tuft';
        const perNode = tuft ? (cur ? 4 : 12) : 1;
        nb.reserve(Math.ceil(cnt / stride + 1) * perNode * (tuft ? 3 : 13), Math.ceil(cnt / stride + 1) * perNode * (tuft ? 6 : 60));
        for (let k = (sh.id * 7) % stride; k < cnt; k += stride) {
          const h = rnd(sh.id, k, 11);
          if (h >= sh.needleLive) continue;
          const node = sp.phyllotaxis === 'opposite' ? Math.floor(k / 2) : k;
          const nodes = sp.phyllotaxis === 'opposite' ? Math.ceil(cnt / 2) : cnt;
          const tposN = (node + 0.5) / nodes;
          const aLeaf = winter ? 9 : aBase - tposN * lag;
          if (aLeaf < 0.04) continue; // list u špičky se ještě nerozvinul
          setTone(aLeaf);
          const openK = smooth(aLeaf);
          L0 = sh.needleLen * (sp.leafShape === 'tuft' ? 0.1 + 0.9 * openK : 0.3 + 0.7 * openK);
          at(cot ? 1 : 0.08 + 0.9 * tposN);
          let phi: number;
          if (cot) phi = (k / cnt) * 6.2832 + sh.id;
          else if (sp.phyllotaxis === 'opposite') phi = (k % 2) * Math.PI + (node % 2) * (Math.PI / 2) + sh.id;
          else if (flat) phi = (k % 2) * Math.PI + (h - 0.5) * 0.5;
          else phi = k * 2.39996 + sh.id;
          for (let q = 0; q < perNode; q++) {
            const a2 = tuft ? phi + q * 2.39996 : phi;
            // svazeček se z pupenu rozevírá: nejdřív sevřený štěteček, pak se jehlice rozloží
            const tiltA = tuft ? (cur ? 0.3 + 0.7 * openK : (0.35 + 0.9 * rnd(sh.id, k * 13 + q, 15)) * (0.2 + 0.8 * openK)) : cot ? 1.25 : flat ? 0.95 + (h - 0.5) * 0.2 : 1.05 + (h - 0.5) * 0.4;
            const sa = Math.sin(tiltA), ca = Math.cos(tiltA), cp = Math.cos(a2), spn = Math.sin(a2);
            // krátké výhony modřínu sedí na boku větve a míří ven; listy visí lehce dolů
            const ax0 = tuft && !cur ? u[0] * cp + w[0] * spn : d[0], ay0 = tuft && !cur ? u[1] * cp + w[1] * spn : d[1], az0 = tuft && !cur ? u[2] * cp + w[2] * spn : d[2];
            const a3 = a2 + (tuft && !cur ? 1.9 * q : 0);
            const c3 = Math.cos(a3), s3 = Math.sin(a3);
            const rx = tuft && !cur ? d[0] * c3 + (u[0] * -spn + w[0] * cp) * s3 : u[0] * cp + w[0] * spn;
            const ry = tuft && !cur ? d[1] * c3 + (u[1] * -spn + w[1] * cp) * s3 : u[1] * cp + w[1] * spn;
            const rz = tuft && !cur ? d[2] * c3 + (u[2] * -spn + w[2] * cp) * s3 : u[2] * cp + w[2] * spn;
            const ld = nrm(ax0 * ca + rx * sa, ay0 * ca + ry * sa - (tuft ? 0.05 : flat ? 0.1 : 0.22), az0 * ca + rz * sa);
            emit(cx, cy, cz, ld, L0 * (tuft ? 0.85 + 0.3 * rnd(sh.id, k * 7 + q, 13) : 0.62 + 0.55 * rnd(sh.id, k * 7 + q, 13)), k * 5 + q);
          }
        }
        continue;
      }
      // jehlice: osvětlené, vrhají a přijímají stín; uvnitř koruny tmavší podle oslunění ze simulace
      const g = needleGrowth(s, sh);
      const nl = sh.needleLen * g;
      if (nl < 0.03) continue;
      const cnt = sh.needleCount;
      const fasc = sh.kind === 'shoot';
      const perF = fasc ? 2 : 1;
      nb.reserve(Math.ceil(cnt / stride + 1) * perF * 7, Math.ceil(cnt / stride + 1) * perF * 30);
      let cr: number, cg: number, cb: number;
      if (sh.kind === 'hypocotyl') { cr = 0.42; cg = 0.6; cb = 0.3; }
      else if (sh.kind === 'epicotyl') { cr = 0.33; cg = 0.53; cb = 0.38; }
      else if (age === 0) { const k = g; cr = 0.56 - 0.2 * k; cg = 0.76 - 0.16 * k; cb = 0.34 - 0.02 * k; }
      else if (age === 1) { cr = 0.31; cg = 0.55; cb = 0.38; }
      else { cr = 0.27; cg = 0.48; cb = 0.35; }
      const nao = 0.6 + 0.4 * sh.light;
      const dying = sh.needleLive < 1 && shedSeason;
      const bare = fasc ? P.bareBase : sh.kind === 'hypocotyl' ? 1 : 0.05;
      const alpha = sh.kind === 'hypocotyl'
        ? 0.12 + 1.05 * smooth((s.day - sh.bornDay - 9) / 14)
        : fasc ? (age === 0 ? 0.22 + 0.6 * g : 0.9 + 0.12 * Math.min(age, 2)) : 1.15;
      for (let k = (sh.id * 7) % stride; k < cnt; k += stride) {
        const h = rnd(sh.id, k, 11);
        if (h >= sh.needleLive) continue;
        const t = bare + (1 - bare) * ((k + 0.5) / cnt);
        at(t);
        const phi = sh.kind === 'hypocotyl' ? (k / cnt) * 6.2832 + sh.id : k * 2.39996 + sh.id;
        const al = alpha + (h - 0.5) * 0.3;
        const sa = Math.sin(al), ca = Math.cos(al), cp = Math.cos(phi), sp = Math.sin(phi);
        const rx = u[0] * cp + w[0] * sp, ry = u[1] * cp + w[1] * sp, rz = u[2] * cp + w[2] * sp;
        const px = cx, py = cy, pz = cz;
        // tečna (kolmo na jehlici) pro šířku a rozevření páru
        const tx = -u[0] * sp + w[0] * cp, ty = -u[1] * sp + w[1] * cp, tz = -u[2] * sp + w[2] * cp;
        let r = cr, gg = cg, b = cb;
        const yellow = dying && h > sh.needleLive - 0.35;
        if (yellow) { r = 0.72; gg = 0.6; b = 0.25; }
        const j = (0.85 + 0.3 * rnd(sh.id, k, 12)) * nao;
        r *= j; gg *= j; b *= j;
        const L = nl * (0.85 + 0.3 * rnd(sh.id, k, 13));
        // normála míří ven z koruny a vzhůru – chomáč jehlic se pak stínuje jako objem, ne jako plošky
        const N = nrm(rx * 0.7 + d[0] * 0.2, ry * 0.7 + d[1] * 0.2 + 0.65, rz * 0.7 + d[2] * 0.2);
        const fs = fasc ? Math.min(0.2, 0.45 / Math.max(L, 0.1)) : 0; // pochva svazečku u báze
        for (let q = 0; q < perF; q++) {
          const sgn = perF === 1 ? 0 : q === 0 ? -0.1 : 0.1;
          const nx = d[0] * ca + rx * sa + tx * sgn, ny = d[1] * ca + ry * sa + ty * sgn - 0.06, nz = d[2] * ca + rz * sa + tz * sgn;
          // každá jehlice má trochu jinou normálu – v protisvětle se pak lesknou jednotlivě
          const jn = (rnd(sh.id, k, 14 + q) - 0.5) * 0.9;
          const M = nrm(N[0] + tx * jn, N[1] + ty * jn, N[2] + tz * jn);
          const hw = nw * 0.5;
          const ring = (f: number, wd: number, cr2: number, cg2: number, cb2: number) => {
            const qx = px + nx * L * f, qy = py + ny * L * f, qz = pz + nz * L * f;
            const i0 = nb.v(qx - tx * hw * wd, qy - ty * hw * wd, qz - tz * hw * wd, M[0], M[1], M[2], cr2, cg2, cb2);
            nb.t(0, 0, f);
            nb.v(qx + tx * hw * wd, qy + ty * hw * wd, qz + tz * hw * wd, M[0], M[1], M[2], cr2, cg2, cb2);
            nb.t(0, 0, f);
            return i0;
          };
          const sheath = fs > 0 && !yellow;
          const r0 = ring(0, 1, sheath ? 0.5 * nao : r * 0.7, sheath ? 0.4 * nao : gg * 0.7, sheath ? 0.27 * nao : b * 0.7);
          const r1 = ring(fs || 0.12, 1, r * 0.72, gg * 0.72, b * 0.72);
          const r2 = ring(0.74, 0.85, r * 1.05, gg * 1.05, b * 1.05);
          const tp = nb.v(px + nx * L, py + ny * L, pz + nz * L, M[0], M[1], M[2], r * 1.2, gg * 1.2, b * 1.12);
          nb.t(0, 0, 1);
          for (const [p0, p1] of [[r0, r1], [r1, r2]]) {
            nb.tri(p0, p0 + 1, p1 + 1); nb.tri(p0, p1 + 1, p1);
            nb.tri(p0, p1 + 1, p0 + 1); nb.tri(p0, p1, p1 + 1);
          }
          nb.tri(r2, r2 + 1, tp); nb.tri(r2, tp, r2 + 1);
        }
      }
    }

    // povrchové kořeny (nebari): několik kořenů se od paty kmene rozbíhá a noří do substrátu
    if (n && R0 > 0.2) {
      const root0 = s.shoots[0];
      const grow = smooth((R0 - 0.2) / 0.7);
      col[0] = C[0]; col[1] = C[1]; col[2] = C[2];
      const rootBark = BK[0];
      const SEG = 8, RN = 8;
      const dy0 = Math.max(0.35, root0.dir[1]), leanX = root0.dir[0] / dy0, leanZ = root0.dir[2] / dy0;
      for (const root of nebari) {
        const k = root.id;
        let az = root.az;
        // kořen nesmí projít stěnou nádoby: délka se omezí vzdáleností k jejímu okraji ve směru kořene
        let Lr = R0 * root.len * (0.5 + 0.5 * grow);
        {
          const pr = potById(this.potOverride ?? s.potId);
          if (pr.shape !== 'ground') {
            const off = this.offsetPreview ?? s.potOffset ?? [0, 0];
            const px = off[0] * (pr.a / 2) * 0.8, pz = off[1] * (pr.b / 2) * 0.8; // poloha stromu vůči středu nádoby
            const dx = Math.cos(root.az), dz = Math.sin(root.az), ha = pr.a / 2 * 0.94, hb = pr.b / 2 * 0.94;
            let reach: number;
            if (pr.shape === 'rect') reach = Math.min(dx > 0 ? (ha - px) / dx : dx < 0 ? (-ha - px) / dx : 1e9, dz > 0 ? (hb - pz) / dz : dz < 0 ? (-hb - pz) / dz : 1e9);
            else {
              const A = (dx * dx) / (ha * ha) + (dz * dz) / (hb * hb), Bq = 2 * ((px * dx) / (ha * ha) + (pz * dz) / (hb * hb)), Cq = (px * px) / (ha * ha) + (pz * pz) / (hb * hb) - 1;
              reach = (-Bq + Math.sqrt(Math.max(0, Bq * Bq - 4 * A * Cq))) / (2 * A);
            }
            Lr = Math.max(R0 * 0.6, Math.min(Lr, reach - R0 * 0.3));
          }
        }
        const thick = Math.min(R0 * root.thick * (0.55 + 0.45 * grow), R0 * 0.6);
        const pts: number[][] = [], rad: number[] = [];
        for (let j = 0; j <= SEG; j++) {
          const f = j / SEG;
          az += (rnd(s.seed, 505 + k, j) - 0.5) * 0.22;
          const rho = R0 * 0.15 + Lr * f;
          // kořen vychází ze středu kmene i u šikmo posazeného stromu: počátek sleduje osu kmene a k zemi se
          // posun ztrácí
          const y = R0 * 0.38 * Math.pow(1 - f, 1.6) - R0 * 0.4 * f * f;
          const lean = Math.pow(1 - f, 2) * R0 * 0.38;
          pts.push([Math.cos(az) * rho * (j === 0 ? 0 : 1) + leanX * lean, y, Math.sin(az) * rho * (j === 0 ? 0 : 1) + leanZ * lean]);
          rad.push(thick * (Math.pow(1 - f, 0.8) * 0.85 + 0.15) * (1 + 0.5 * Math.pow(1 - f, 4)));
        }
        bb.reserve((SEG + 1) * (RN + 1) + 1, SEG * RN * 6);
        let uu: Vec3 = [0, 1, 0], prev = -1;
        const tile = 2.4 + thick * 1.8, tiles = Math.max(1, Math.round((6.2832 * thick) / tile));
        for (let j = 0; j <= SEG; j++) {
          const a0 = pts[Math.max(0, j - 1)], a1 = pts[Math.min(SEG, j + 1)];
          const dd = nrm(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]);
          const kk = uu[0] * dd[0] + uu[1] * dd[1] + uu[2] * dd[2];
          uu = nrm(uu[0] - dd[0] * kk, uu[1] - dd[1] * kk, uu[2] - dd[2] * kk);
          const ww: Vec3 = [dd[1] * uu[2] - dd[2] * uu[1], dd[2] * uu[0] - dd[0] * uu[2], dd[0] * uu[1] - dd[1] * uu[0]];
          const first = bb.nv;
          for (let q = 0; q <= RN; q++) {
            const a = (q / RN) * 6.2832;
            const nx = uu[0] * Math.cos(a) + ww[0] * Math.sin(a), ny = uu[1] * Math.cos(a) + ww[1] * Math.sin(a), nz = uu[2] * Math.cos(a) + ww[2] * Math.sin(a);
            // kořen je vyšší než širší – hřbet nad substrátem
            const rr = rad[j] * (1 + 0.25 * ny * ny) * (1 + 0.08 * (rnd(k, q % RN, j + 30) - 0.5));
            // ke konci kořen tmavne do barvy substrátu
            const e = j / SEG, c0 = 0.8 * (1 - e), c1 = e;
            bb.v(pts[j][0] + nx * rr, pts[j][1] + ny * rr, pts[j][2] + nz * rr, nx, ny, nz, col[0] * c0 + 0.34 * c1, col[1] * c0 + 0.27 * c1, col[2] * c0 + 0.21 * c1);
            bb.t((q / RN) * tiles, (j / SEG) * (Lr / (tile * 2)) + k * 0.37, rootBark);
          }
          if (j === 0) {
            // uzavřený začátek (leží uvnitř kmene, ale při pohledu zblízka nesmí být vidět dovnitř)
            bb.reserve(1, RN * 3);
            const cc = bb.v(pts[0][0] - dd[0] * rad[0] * 0.4, pts[0][1] - dd[1] * rad[0] * 0.4, pts[0][2] - dd[2] * rad[0] * 0.4, -dd[0], -dd[1], -dd[2], col[0] * 0.8, col[1] * 0.8, col[2] * 0.8);
            bb.t(0.5, k * 0.37, rootBark);
            for (let q = 0; q < RN; q++) bb.tri(first + q + 1, first + q, cc);
          }
          if (prev >= 0) for (let q = 0; q < RN; q++) { bb.tri(prev + q, prev + q + 1, first + q); bb.tri(prev + q + 1, first + q + 1, first + q); }
          prev = first;
        }
      }
    }

    wb.apply(this.wood.geometry, true);
    bb.apply(this.bark.geometry, true);
    nb.apply(this.needles.geometry, true);
    this.seedMesh.visible = s.stage === 'seed';
    this.updatePot(s.potId, H);
    // strom stojí v počátku; posun ke kraji misky se dělá posunem nádoby a stolu opačným směrem
    const off = this.offsetPreview ?? s.potOffset ?? [0, 0];
    const psO = potById(this.potOverride ?? s.potId);
    const ox = psO.shape === 'ground' ? 0 : -off[0] * (psO.a / 2) * 0.8, oz = psO.shape === 'ground' ? 0 : -off[1] * (psO.b / 2) * 0.8;
    this.potGroup.position.set(ox, 0, oz);
    this.table.position.x = ox; this.table.position.z = oz;
    // podložka musí pojmout nádobu i stín stromu
    const ps = potById(this.potOverride ?? s.potId);
    {
      const wdt = Math.max(Math.max(ps.a, ps.b) * 3.4, H * 1.9, 40), dep = wdt * 0.62, th = Math.max(2, wdt * 0.035);
      this.table.scale.set(wdt, th, dep);
      this.table.position.y = this.tableTop - th / 2;
      // nářadí leží vpředu na stole: nůžky vlevo, drát vpravo; velikost podle stolu
      const potW = Math.max(ps.a, ps.b);
      const size = Math.max(9, potW * 0.6);
      for (const [g, sx, id] of [[this.toolScissors, -1, 'cut'], [this.toolWire, 1, 'wire']] as [THREE.Group, number, string][]) {
        g.visible = this.table.visible;
        g.scale.setScalar(size * (id === 'wire' ? 0.75 : 1));
        g.position.set(ox + sx * (ps.a / 2 + size * 0.75), this.tableTop + (this.activeTool === id ? size * 0.12 : 0), oz + ps.b * 0.35 * -sx); // z výchozího pohledu nůžky vlevo, drát vpravo
        g.rotation.set(0, id === 'cut' ? 0.9 : 0.3, this.activeTool === id ? 0.12 : 0);
      }
      (this.table.material as THREE.MeshStandardMaterial).map!.repeat.set(wdt / 60, dep / 60);
    }

    // slunce a rozsah stínové mapy podle velikosti stromu
    const R = Math.max(16, H * 1.2);
    const sc = this.sun.shadow.camera;
    this.sun.target.position.set(0, H * 0.4, 0);
    this.sun.position.set(0.48 * R * 3, H * 0.4 + 0.8 * R * 3, 0.36 * R * 3);
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.3; sc.far = R * 7;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = R * 0.004;
    this.sun.shadow.needsUpdate = true;
    {
      // pozadí podle ročního období (a tmavší ve tmavém vzhledu stránky)
      const season = doy < 60 || doy > 335 ? [0.86, 0.9, 0.98] : doy < 150 ? [1, 1.02, 0.97] : doy < 265 ? [1, 1, 0.96] : [1.05, 0.95, 0.82];
      const root = document.documentElement;
      const dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const k = dark ? 0.42 : 1;
      (this.backdrop.material as THREE.MeshBasicMaterial).color.setRGB(season[0] * k, season[1] * k, season[2] * k);
    }
    this.windU.uH.value = Math.max(5, H);
    this.needsRender = true;
  }

  // ------------------------------------------------------------ výběr

  /** Najde pupen nebo výhon nejblíž kurzoru (v obrazovkových pixelech – tenké větvičky se dají trefit). */
  pick(x: number, y: number): Pick | null {
    const s = this.state, fr = this.frames;
    if (!s || !fr) return null;
    const W = this.canvas.clientWidth, Hh = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    const proj = (px: number, py: number, pz: number): [number, number, number] => {
      v.set(px, py, pz).project(this.camera);
      return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * Hh, v.z];
    };
    let best: Pick | null = null, bestScore = 16;
    for (let i = 0; i < s.shoots.length; i++) {
      const sh = s.shoots[i];
      const b = fr.base, tp = fr.tip;
      const [ax, ay, az] = proj(b[i * 3], b[i * 3 + 1], b[i * 3 + 2]);
      const [cx, cy, cz] = proj(tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2]);
      if (az > 1 || cz > 1) continue;
      for (const bud of sh.buds) {
        const [qx, qy] = proj(
          b[i * 3] + (tp[i * 3] - b[i * 3]) * bud.t + bud.dir[0] * 0.3,
          b[i * 3 + 1] + (tp[i * 3 + 1] - b[i * 3 + 1]) * bud.t + bud.dir[1] * 0.3,
          b[i * 3 + 2] + (tp[i * 3 + 2] - b[i * 3 + 2]) * bud.t + bud.dir[2] * 0.3);
        const dd = Math.hypot(qx - x, qy - y) - 5; // pupeny mají přednost
        if (dd < bestScore) { bestScore = dd; best = { type: 'bud', shoot: sh.id, bud: bud.id }; }
      }
      const ex = cx - ax, ey = cy - ay;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1) continue;
      const t = clamp(((x - ax) * ex + (y - ay) * ey) / l2, 0, 1);
      const dd = Math.hypot(ax + ex * t - x, ay + ey * t - y) + (az + (cz - az) * t) * 2;
      const thick = Math.max(0, (radiusOf(sh) / this.dist) * Hh * 1.6 - 2);
      if (dd - thick < bestScore) { bestScore = dd - thick; best = { type: 'shoot', shoot: sh.id, t }; }
    }
    return best;
  }

  /** Kam by se větev ohnula, kdyby její špička šla za kurzorem (v rovině obrazovky procházející patou). */
  bendTarget(id: number, x: number, y: number): { axis: Vec3; angle: number } | null {
    const s = this.state, fr = this.frames;
    const i = fr?.index.get(id);
    if (!s || !fr || i === undefined) return null;
    const B = new THREE.Vector3(fr.base[i * 3], fr.base[i * 3 + 1], fr.base[i * 3 + 2]);
    const ndc = new THREE.Vector2((x / this.canvas.clientWidth) * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), B);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const d = new THREE.Vector3(...s.shoots[i].dir);
    const nd = hit.sub(B).normalize();
    const axis = new THREE.Vector3().crossVectors(d, nd);
    if (axis.length() < 1e-4) return null;
    axis.normalize();
    return { axis: [axis.x, axis.y, axis.z], angle: d.angleTo(nd) };
  }

  /** Náhled ohybu: kostra větve z pokusného stavu (po ohybu); barva podle rizika. */
  previewState(tmp: State, id: number, risky: boolean) {
    const fr = computeFrames(tmp);
    const i = fr.index.get(id);
    if (i === undefined) return;
    const pts: number[] = [];
    const sub = new Set<number>([id]);
    for (let j = i; j < tmp.shoots.length; j++) {
      const c = tmp.shoots[j];
      if (j !== i && !sub.has(c.parent)) continue;
      sub.add(c.id);
      const seg = c.arc ? 10 : 1;
      let p = [fr.base[j * 3], fr.base[j * 3 + 1], fr.base[j * 3 + 2]];
      for (let k = 1; k <= seg; k++) {
        const q = shootPoint(c, k / seg);
        const n = [fr.base[j * 3] + q[0], fr.base[j * 3 + 1] + q[1], fr.base[j * 3 + 2] + q[2]];
        pts.push(...p, ...n);
        p = n;
      }
    }
    this.setLines(pts, risky ? 0xff3b1f : 0x1f9d55);
    this.marker.position.set(fr.base[i * 3], fr.base[i * 3 + 1], fr.base[i * 3 + 2]);
    this.marker.scale.setScalar(this.dist * 0.006);
    this.marker.visible = true;
  }

  private setLines(pts: number[], color: number) {
    this.hi.geometry.dispose();
    this.hi.geometry = new THREE.BufferGeometry();
    this.hi.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    (this.hi.material as THREE.LineBasicMaterial).color.setHex(color);
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.hi.visible = pts.length > 0;
    this.needsRender = true;
  }

  /** Zvýrazní, co by zásah odstranil (nůžky) nebo čeho se týká (drát). */
  highlight(p: Pick | null, color = 0xff3b1f) {
    const s = this.state, fr = this.frames;
    if (!p || !s || !fr) {
      if (this.hi.visible || this.marker.visible) this.needsRender = true;
      this.hi.visible = false; this.marker.visible = false;
      return;
    }
    const i = fr.index.get(p.shoot);
    if (i === undefined) return;
    const pts: number[] = [];
    const b = fr.base, tp = fr.tip;
    const at = (j: number, t: number) => [b[j * 3] + (tp[j * 3] - b[j * 3]) * t, b[j * 3 + 1] + (tp[j * 3 + 1] - b[j * 3 + 1]) * t, b[j * 3 + 2] + (tp[j * 3 + 2] - b[j * 3 + 2]) * t];
    let m: number[];
    if (p.type === 'bud') {
      const bud = s.shoots[i].buds.find((x) => x.id === p.bud);
      m = at(i, bud ? bud.t : 1);
      if (bud) m = [m[0] + bud.dir[0] * 0.3, m[1] + bud.dir[1] * 0.3, m[2] + bud.dir[2] * 0.3];
    } else {
      m = at(i, p.t);
      pts.push(...m, ...at(i, 1));
      const gone = new Set<number>([-2]);
      for (let j = i + 1; j < s.shoots.length; j++) {
        const c = s.shoots[j];
        if ((c.parent === p.shoot && c.attachT > p.t) || gone.has(c.parent)) {
          gone.add(c.id);
          pts.push(...at(j, 0), ...at(j, 1));
        }
      }
    }
    this.setLines(pts, color);
    this.marker.position.set(m[0], m[1], m[2]);
    this.marker.scale.setScalar(this.dist * 0.0075);
    this.marker.visible = true;
    this.needsRender = true;
  }
}
