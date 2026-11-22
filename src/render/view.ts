// 3D pohled: z čistého stavu simulace staví geometrii (dřevo, pupeny, jehlice), řeší kameru a výběr myší.
// Simulace o rendereru neví nic – renderer jen čte State.

import * as THREE from 'three';
import type { PotType, Shoot, State } from '../sim/types';
import { P } from '../sim/params';
import { Frames, basis, clamp, computeFrames, doyOf, needleGrowth, radiusOf, rnd, smooth, yearOf } from '../sim/util';

export type Pick =
  | { type: 'bud'; shoot: number; bud: number }
  | { type: 'shoot'; shoot: number; t: number };

class Buf {
  pos = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  nor = new Float32Array(3 * 4096);
  idx = new Uint32Array(3 * 4096);
  nv = 0;
  ni = 0;
  reset() { this.nv = 0; this.ni = 0; }
  private grow(v: number, i: number) {
    if ((this.nv + v) * 3 > this.pos.length) {
      const cap = Math.max(this.pos.length * 2, (this.nv + v) * 3);
      for (const k of ['pos', 'col', 'nor'] as const) { const a = new Float32Array(cap); a.set(this[k]); this[k] = a; }
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
  tri(a: number, b: number, c: number) { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  apply(geo: THREE.BufferGeometry, withNormals: boolean) {
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.subarray(0, this.nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.subarray(0, this.nv * 3), 3));
    if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(this.nor.subarray(0, this.nv * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(this.idx.subarray(0, this.ni), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 100, 0), 1e5);
  }
}

const RAD = 6;
const MAX_FASCICLES = 42000;

function woodColor(s: State, sh: Shoot, out: number[]) {
  const age = yearOf(s.day) - sh.bornYear;
  const r = radiusOf(sh);
  let c: number[];
  if (sh.dead) c = [0.7, 0.67, 0.61];
  else if (sh.kind === 'hypocotyl' && age === 0) c = [0.62, 0.47, 0.4];
  else if (sh.elong && sh.kind === 'shoot') {
    const e = sh.targetLen > 0 ? sh.len / sh.targetLen : 1;
    c = [0.76 - 0.26 * e, 0.7 - 0.14 * e, 0.5 - 0.2 * e]; // svíčka: plavá -> zelená
  } else if (age === 0) c = [0.47, 0.53, 0.3];
  else if (age <= 3) c = [0.5, 0.43, 0.33];
  else {
    const k = smooth((r - 1.8) / 4); // tenčí kmen oranžová šupinatá borka, silný kmen šedohnědé desky
    c = [0.7 - 0.33 * k, 0.45 - 0.14 * k, 0.25 + 0.02 * k];
  }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

export class TreeView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 20000);
  private wood = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  private needles = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  private hi = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private potGroup = new THREE.Group();
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
    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x6b5a48, 1.15));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
    sun.position.set(0.5, 1, 0.35);
    this.scene.add(sun);
    this.hi.renderOrder = 10; this.marker.renderOrder = 11;
    this.hi.visible = false; this.marker.visible = false;
    this.seedMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.8 }));
    this.seedMesh.scale.set(0.22, 0.12, 0.14);
    this.seedMesh.position.set(0, 0.1, 0);
    this.scene.add(this.wood, this.needles, this.hi, this.marker, this.potGroup, this.seedMesh);
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

  private updateCamera() {
    if (this.auto) {
      const H = Math.max(4, this.height);
      const narrow = this.camera.aspect < 0.8 ? 1.5 : 1;
      const td = (H * 2.35 + 26) * narrow, ty = H * 0.46;
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
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ nádoba

  private updatePot(pot: PotType, H: number, baseR: number) {
    const size = pot === 'ground' ? 0 : pot === 'training'
      ? Math.max(8, Math.round((baseR * 7 + H * 0.16) / 4) * 4)
      : Math.max(10, Math.round((baseR * 6 + H * 0.3) / 4) * 4);
    const key = pot + size;
    if (key === this.potKey) return;
    this.potKey = key;
    for (const c of [...this.potGroup.children]) {
      this.potGroup.remove(c);
      const m = c as THREE.Mesh;
      m.geometry.dispose();
    }
    const soil = new THREE.MeshStandardMaterial({ color: 0x4d3d30, roughness: 1 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number, sx = 1, sz = 1) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y; mesh.scale.set(sx, 1, sz);
      this.potGroup.add(mesh);
    };
    if (pot === 'ground') {
      add(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7a4a, roughness: 1 }), -0.02);
      add(new THREE.CircleGeometry(Math.max(10, H * 0.25), 32).rotateX(-Math.PI / 2), soil, 0);
    } else if (pot === 'training') {
      const h = size * 1.5;
      add(new THREE.CylinderGeometry(size, size * 0.78, h, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xa5583a, roughness: 0.85, side: THREE.DoubleSide }), -h / 2 + size * 0.12);
      add(new THREE.TorusGeometry(size, size * 0.05, 8, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9b5236, roughness: 0.85 }), size * 0.12);
      add(new THREE.CircleGeometry(size * 0.985, 32).rotateX(-Math.PI / 2), soil, 0);
    } else {
      const h = size * 0.32;
      const glaze = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.6, side: THREE.DoubleSide });
      add(new THREE.CylinderGeometry(size, size * 0.9, h, 40, 1, true), glaze, -h / 2 + size * 0.04, 1.35, 1);
      add(new THREE.CylinderGeometry(size * 0.8, size * 0.8, size * 0.08, 40), glaze, -h + size * 0.02, 1.35, 1);
      add(new THREE.CircleGeometry(size * 0.985, 40).rotateX(-Math.PI / 2), soil, 0, 1.35, 1);
    }
  }

  // ------------------------------------------------------------ geometrie stromu

  setState(s: State) {
    this.state = s;
    this.build();
  }

  private build() {
    const s = this.state!;
    const fr = (this.frames = computeFrames(s));
    const n = s.shoots.length;
    const year = yearOf(s.day), doy = doyOf(s.day);
    const { base, tip } = fr;
    const wb = this.wb, nb = this.nb;
    wb.reset(); nb.reset();
    this.builtDist = this.dist;

    // poloměr na vrcholu = poloměr pokračujícího výhonu
    const mainR = new Float32Array(n);
    let H = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      if (sh.parent >= 0 && sh.attachT > 0.98) {
        const pi = fr.index.get(sh.parent)!;
        const r = radiusOf(sh);
        if (sh.isMain || mainR[pi] === 0) mainR[pi] = Math.max(mainR[pi], sh.isMain ? r : r * 0.9);
      }
      if (!sh.dead) H = Math.max(H, tip[i * 3 + 1]);
      total += sh.needleCount * sh.needleLive;
    }
    this.height = H;
    const stride = Math.max(1, Math.ceil(total / MAX_FASCICLES));
    const nw = Math.max(0.085, this.dist * 0.0017) * Math.sqrt(stride);
    const budG = s.budSetYear === year ? 0.3 + 0.7 * smooth((s.gdd - s.budSetGdd) / P.budGrowGdd) : 1.1;
    const col = [0, 0, 0];
    const shedSeason = doy >= P.shedStartDoy && doy < P.shedEndDoy + 20;

    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const d = sh.dir;
      const [u, w] = basis(d);
      const len = sh.len;
      let rb = radiusOf(sh);
      if (sh.elong && sh.targetLen > 0) rb *= 0.55 + 0.45 * (len / sh.targetLen);
      const rt = sh.dead ? rb * 0.6 : mainR[i] > 0 ? Math.min(rb, mainR[i]) : rb * 0.72;
      woodColor(s, sh, col);

      if (len > 0.01) {
        // válec: kroužky pata -> vrchol, kořenový výhon má u země náběh
        const rings: [number, number][] = i === 0 ? [[0, rb * 1.45], [Math.min(0.3, 1.2 * rb / len), rb], [1, rt]] : [[0, rb], [1, rt]];
        wb.reserve(rings.length * RAD + 1, rings.length * RAD * 6);
        let prev = -1;
        for (const [t, r] of rings) {
          const first = wb.nv;
          const shade = 0.88 + 0.24 * rnd(sh.id, 5, Math.round(t * 10));
          for (let k = 0; k < RAD; k++) {
            const a = (k / RAD) * 6.2832;
            const nx = u[0] * Math.cos(a) + w[0] * Math.sin(a), ny = u[1] * Math.cos(a) + w[1] * Math.sin(a), nz = u[2] * Math.cos(a) + w[2] * Math.sin(a);
            wb.v(bx + d[0] * len * t + nx * r, by + d[1] * len * t + ny * r, bz + d[2] * len * t + nz * r, nx, ny, nz, col[0] * shade, col[1] * shade, col[2] * shade);
          }
          if (prev >= 0) for (let k = 0; k < RAD; k++) {
            const k2 = (k + 1) % RAD;
            wb.tri(prev + k, prev + k2, first + k); wb.tri(prev + k2, first + k2, first + k);
          }
          prev = first;
        }
        const cut = sh.tipCut && !sh.elong ? 0.2 : 0.8;
        const c = wb.v(bx + d[0] * (len + rt * cut), by + d[1] * (len + rt * cut), bz + d[2] * (len + rt * cut), d[0], d[1], d[2],
          sh.tipCut ? 0.8 : col[0], sh.tipCut ? 0.7 : col[1], sh.tipCut ? 0.5 : col[2]);
        for (let k = 0; k < RAD; k++) wb.tri(prev + k, prev + (k + 1) % RAD, c);
      }

      if (sh.dead) continue;

      // pupeny: vejčité, červenohnědé, se světlou zasmolenou špičkou
      for (const b of sh.buds) {
        const bl = Math.min(1.5, 0.28 + 0.045 * b.len) * budG, br = bl * 0.3;
        const off = b.kind === 'terminal' || b.t < 0.98 ? 0 : rt * 0.5;
        const ox = bx + d[0] * len * b.t + b.dir[0] * off, oy = by + d[1] * len * b.t + b.dir[1] * off, oz = bz + d[2] * len * b.t + b.dir[2] * off;
        const [bu, bw] = basis(b.dir);
        wb.reserve(3 * RAD + 1, 3 * RAD * 6);
        let prev = -1;
        for (const [t, r, cr, cg, cb] of [[0, 0.7, 0.5, 0.3, 0.2], [0.4, 1, 0.62, 0.36, 0.24], [0.78, 0.55, 0.7, 0.5, 0.36]] as number[][]) {
          const first = wb.nv;
          for (let k = 0; k < RAD; k++) {
            const a = (k / RAD) * 6.2832;
            const nx = bu[0] * Math.cos(a) + bw[0] * Math.sin(a), ny = bu[1] * Math.cos(a) + bw[1] * Math.sin(a), nz = bu[2] * Math.cos(a) + bw[2] * Math.sin(a);
            wb.v(ox + b.dir[0] * bl * t + nx * br * r, oy + b.dir[1] * bl * t + ny * br * r, oz + b.dir[2] * bl * t + nz * br * r, nx, ny, nz, cr, cg, cb);
          }
          if (prev >= 0) for (let k = 0; k < RAD; k++) {
            const k2 = (k + 1) % RAD;
            wb.tri(prev + k, prev + k2, first + k); wb.tri(prev + k2, first + k2, first + k);
          }
          prev = first;
        }
        const c = wb.v(ox + b.dir[0] * bl, oy + b.dir[1] * bl, oz + b.dir[2] * bl, b.dir[0], b.dir[1], b.dir[2], 0.82, 0.7, 0.55);
        for (let k = 0; k < RAD; k++) wb.tri(prev + k, prev + (k + 1) % RAD, c);
      }

      // jehlice
      if (sh.needleCount <= 0 || sh.needleLive <= 0) continue;
      const g = needleGrowth(s, sh);
      const nl = sh.needleLen * g;
      if (nl < 0.03) continue;
      const age = year - sh.bornYear;
      const cnt = sh.needleCount;
      const fasc = sh.kind === 'shoot';
      const perF = fasc ? 2 : 1;
      nb.reserve(Math.ceil(cnt / stride + 1) * perF * 3, Math.ceil(cnt / stride + 1) * perF * 3);
      let cr: number, cg: number, cb: number;
      if (sh.kind === 'hypocotyl') { cr = 0.42; cg = 0.6; cb = 0.3; }
      else if (sh.kind === 'epicotyl') { cr = 0.33; cg = 0.53; cb = 0.38; }
      else if (age === 0) { const k = g; cr = 0.5 - 0.2 * k; cg = 0.66 - 0.16 * k; cb = 0.3 - 0.02 * k; }
      else if (age === 1) { cr = 0.24; cg = 0.43; cb = 0.3; }
      else { cr = 0.21; cg = 0.37; cb = 0.28; }
      const dying = sh.needleLive < 1 && shedSeason;
      const bare = fasc ? P.bareBase : sh.kind === 'hypocotyl' ? 1 : 0.05;
      const alpha = sh.kind === 'hypocotyl'
        ? 0.12 + 1.05 * smooth((s.day - sh.bornDay - 9) / 14) * (age === 0 ? 1 : 1)
        : fasc ? (age === 0 ? 0.22 + 0.6 * g : 0.9 + 0.12 * Math.min(age, 2)) : 1.15;
      for (let k = (sh.id * 7) % stride; k < cnt; k += stride) {
        const h = rnd(sh.id, k, 11);
        if (h >= sh.needleLive) continue;
        const t = bare + (1 - bare) * ((k + 0.5) / cnt);
        const phi = sh.kind === 'hypocotyl' ? (k / cnt) * 6.2832 + sh.id : k * 2.39996 + sh.id;
        const al = alpha + (h - 0.5) * 0.3;
        const sa = Math.sin(al), ca = Math.cos(al), cp = Math.cos(phi), sp = Math.sin(phi);
        const rx = u[0] * cp + w[0] * sp, ry = u[1] * cp + w[1] * sp, rz = u[2] * cp + w[2] * sp;
        const px = bx + d[0] * len * t, py = by + d[1] * len * t, pz = bz + d[2] * len * t;
        // tečna (kolmo na jehlici) pro šířku a rozevření páru
        const tx = -u[0] * sp + w[0] * cp, ty = -u[1] * sp + w[1] * cp, tz = -u[2] * sp + w[2] * cp;
        let r = cr, gg = cg, b = cb;
        const yellow = dying && h > sh.needleLive - 0.35;
        if (yellow) { r = 0.72; gg = 0.6; b = 0.25; }
        const j = 0.85 + 0.3 * rnd(sh.id, k, 12);
        r *= j; gg *= j; b *= j;
        const L = nl * (0.85 + 0.3 * rnd(sh.id, k, 13));
        for (let q = 0; q < perF; q++) {
          const sgn = perF === 1 ? 0 : q === 0 ? -0.1 : 0.1;
          const nx = d[0] * ca + rx * sa + tx * sgn, ny = d[1] * ca + ry * sa + tx * 0 + ty * sgn - 0.06, nz = d[2] * ca + rz * sa + tz * sgn;
          const a0 = nb.v(px - tx * nw * 0.5, py - ty * nw * 0.5, pz - tz * nw * 0.5, 0, 1, 0, r * 0.62, gg * 0.62, b * 0.62);
          const a1 = nb.v(px + tx * nw * 0.5, py + ty * nw * 0.5, pz + tz * nw * 0.5, 0, 1, 0, r * 0.62, gg * 0.62, b * 0.62);
          const a2 = nb.v(px + nx * L, py + ny * L, pz + nz * L, 0, 1, 0, r * 1.12, gg * 1.12, b * 1.12);
          nb.tri(a0, a1, a2);
        }
      }
    }

    wb.apply(this.wood.geometry, true);
    nb.apply(this.needles.geometry, false);
    this.seedMesh.visible = s.stage === 'seed';
    this.updatePot(s.pot, H, n ? radiusOf(s.shoots[0]) : 0);
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

  /** Zvýrazní, co by zásah odstranil. */
  highlight(p: Pick | null) {
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
    this.hi.geometry.dispose();
    this.hi.geometry = new THREE.BufferGeometry();
    this.hi.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.hi.visible = pts.length > 0;
    this.marker.position.set(m[0], m[1], m[2]);
    this.marker.scale.setScalar(this.dist * 0.0075);
    this.marker.visible = true;
    this.needsRender = true;
  }
}
