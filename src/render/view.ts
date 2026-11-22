// 3D pohled: z čistého stavu simulace staví geometrii (dřevo, pupeny, jehlice), řeší kameru a výběr myší.
// Simulace o rendereru neví nic – renderer jen čte State.

import * as THREE from 'three';
import type { PotType, Shoot, State } from '../sim/types';
import { P, potById } from '../sim/params';
import type { Vec3 } from '../sim/types';
import { Frames, basis, clamp, computeFrames, doyOf, needleGrowth, radiusOf, rnd, rotate, shootPoint, smooth, yearOf } from '../sim/util';

export type Pick =
  | { type: 'bud'; shoot: number; bud: number }
  | { type: 'shoot'; shoot: number; t: number };

class Buf {
  pos = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  nor = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  idx = new Uint32Array(3 * 4096);
  nv = 0;
  ni = 0;
  reset() { this.nv = 0; this.ni = 0; }
  private grow(v: number, i: number) {
    if ((this.nv + v) * 3 > this.pos.length) {
      const cap = Math.max(this.pos.length * 2, (this.nv + v) * 3);
      for (const k of ['pos', 'col', 'nor'] as const) { const a = new Float32Array(cap); a.set(this[k]); this[k] = a; }
      const u = new Float32Array((cap / 3) * 2); u.set(this.uv); this.uv = u;
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
  t(u: number, v: number) { const o = (this.nv - 1) * 2; this.uv[o] = u; this.uv[o + 1] = v; }
  tri(a: number, b: number, c: number) { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  apply(geo: THREE.BufferGeometry, withNormals: boolean) {
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.subarray(0, this.nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col.subarray(0, this.nv * 3), 3));
    if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(this.nor.subarray(0, this.nv * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv.subarray(0, this.nv * 2), 2));
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

/** Borka: podélně protažené šupiny oddělené tmavými prasklinami. Slouží jako barva i jako reliéf. */
function barkTexture(): THREE.CanvasTexture {
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    // pokřivení souřadnic, aby praskliny nebyly rovné
    const wx = u + 0.06 * (tileNoise(u * 4, v * 6, 4, 6, 11) - 0.5), wy = v + 0.03 * (tileNoise(u * 6, v * 8, 6, 8, 12) - 0.5);
    let ridge = 0, amp = 0.6, fx = 5, fy = 3;
    for (let o = 0; o < 3; o++) {
      const n = tileNoise(wx * fx, wy * fy, fx, fy, 20 + o);
      ridge += amp * Math.abs(2 * n - 1);
      amp *= 0.5; fx *= 2; fy *= 2;
    }
    const crack = Math.min(1, ridge * 1.7); // 0 = dno praskliny, 1 = plocha šupiny
    const flake = tileNoise(u * 32, v * 48, 32, 48, 40);
    const g = Math.max(0, Math.min(1, 0.42 + 0.58 * Math.pow(crack, 0.6) + 0.14 * (flake - 0.5)));
    const o = (y * W + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(g * 255);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
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
  private wood = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  private bark: THREE.Mesh;
  private needles = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  private sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
  private soilTex = soilTexture();
  private table: THREE.Mesh;
  private bb = new Buf();
  private hi = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3b1f, depthTest: false, transparent: true }));
  private wireLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd21f, depthTest: false, transparent: true }));
  private wireDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffd21f, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }));
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
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a6a55, 0.95));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
    const barkTex = barkTexture();
    this.bark = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, map: barkTex, bumpMap: barkTex, bumpScale: 3 }));
    for (const m of [this.wood, this.bark, this.needles]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    this.table = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xa39f94, roughness: 1, transparent: true, alphaMap: fadeTexture(), depthWrite: false }));
    this.table.receiveShadow = true;
    this.scene.add(this.table);
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

  private potOverride: string | null = null;
  /** Náhled jiné nádoby v dialogu přesazení (null = skutečná nádoba stromu). */
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
    const soil = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sz = 1) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z); mesh.scale.set(sx, 1, sz);
      mesh.receiveShadow = true; mesh.castShadow = m !== soil;
      this.potGroup.add(mesh);
      return mesh;
    };
    this.table.visible = spec.shape !== 'ground';
    if (spec.shape === 'ground') {
      add(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7a4a, roughness: 1 }), 0, -0.02).castShadow = false;
      add(new THREE.CircleGeometry(groundR, 40).rotateX(-Math.PI / 2), soil);
      return;
    }
    const wall = new THREE.MeshStandardMaterial({ color: spec.color, roughness: spec.glaze ? 0.3 : 0.85, metalness: spec.glaze ? 0.05 : 0, side: THREE.DoubleSide });
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
    this.table.position.y = -h - footH - 0.02;
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
    const lines: number[] = [], dots: number[] = [];
    if (on && s && fr) {
      for (let i = 0; i < s.shoots.length; i++) {
        const sh = s.shoots[i];
        if (!sh.wire) continue;
        const seg = Math.max(sh.arc ? 12 : 4, Math.min(24, Math.round(sh.len / 1.5)));
        let p = [fr.base[i * 3], fr.base[i * 3 + 1], fr.base[i * 3 + 2]];
        dots.push(...p);
        for (let k = 1; k <= seg; k++) {
          const q = shootPoint(sh, k / seg);
          const n = [fr.base[i * 3] + q[0], fr.base[i * 3 + 1] + q[1], fr.base[i * 3 + 2] + q[2]];
          lines.push(...p, ...n);
          dots.push(...n);
          p = n;
        }
      }
    }
    for (const [obj, pts] of [[this.wireLines, lines], [this.wireDots, dots]] as [THREE.Object3D & { geometry: THREE.BufferGeometry }, number[]][]) {
      obj.geometry.dispose();
      obj.geometry = new THREE.BufferGeometry();
      obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
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
    this.builtDist = this.dist;

    // pokračující výhon určuje poloměr na vrcholu a směr, kterým osa plynule navazuje
    const mainR = new Float32Array(n);
    const mainKid = new Int32Array(n).fill(-1);
    let H = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      if (sh.parent >= 0 && sh.attachT > 0.98) {
        const pi = fr.index.get(sh.parent)!;
        const r = radiusOf(sh);
        if (sh.isMain) mainKid[pi] = i;
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
    const R0 = n ? radiusOf(s.shoots[0]) : 0;
    const zone = 3.2 * R0 * smooth((R0 - 0.12) / 0.5);
    const endTan = (sh: Shoot): Vec3 => (sh.arc ? rotate(sh.dir, sh.arc.axis, sh.arc.angle) : sh.dir);
    const nrm = (x: number, y: number, z: number): Vec3 => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

    for (let i = 0; i < n; i++) {
      const sh = s.shoots[i];
      const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
      const d0 = sh.dir;
      const [u0, w0] = basis(d0);
      const len = sh.len;
      const arc = sh.arc;
      const age = year - sh.bornYear;

      // Hladké napojení: v kloubu mezi výhonem a jeho pokračováním má osa společnou tečnu (Hermitova křivka),
      // takže kmen neroste po zalomených tyčkách. Koncové body zůstávají tam, kde je má simulace.
      let T0: Vec3 = d0, T1: Vec3 = d0;
      if (!arc) {
        if (sh.isMain && sh.attachT > 0.98 && sh.parent >= 0) {
          const pe = endTan(s.shoots[fr.index.get(sh.parent)!]);
          T0 = nrm(pe[0] + d0[0], pe[1] + d0[1], pe[2] + d0[2]);
        }
        if (mainKid[i] >= 0) { const c = s.shoots[mainKid[i]].dir; T1 = nrm(d0[0] + c[0], d0[1] + c[1], d0[2] + c[2]); }
      }
      const dot0 = T0[0] * d0[0] + T0[1] * d0[1] + T0[2] * d0[2], dot1 = T1[0] * d0[0] + T1[1] * d0[1] + T1[2] * d0[2];
      const curved = !arc && len > 0.05 && (dot0 < 0.9995 || dot1 < 0.9995);

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
      const rt = sh.dead ? rb * 0.6 : mainR[i] > 0 ? Math.min(rb, mainR[i]) : rb * 0.72;
      woodColor(s, sh, col);
      const ao = sh.dead ? 1 : 0.8 + 0.2 * sh.light;
      // kořenové náběhy u země a límec v nasazení větve
      const flareAmt = (!sh.isMain && sh.parent >= 0 ? 0.3 : 0) * smooth((rb - 0.12) / 0.5);
      // kořenové náběhy: kmen se u země rozšiřuje do výšky ~3 poloměrů, přes hranice ročních úseků
      const onTrunk = i === 0 || (sh.order === 0 && sh.isMain);
      const inZone = onTrunk && by < zone && zone > 0.2;
      const tc = len > 0 ? Math.min(0.4, (2.6 * rb) / len) : 0;
      const radiusAt = (t: number) => (rb + (rt - rb) * t) * (flareAmt > 0 && t < tc ? 1 + flareAmt * (1 - t / tc) * (1 - t / tc) : 1);

      if (len > 0.01) {
        const isBark = !sh.dead && age >= 3;
        const B = isBark ? bb : wb;
        const RN = rb < 0.25 ? 6 : rb < 0.8 ? 8 : rb < 2 ? 12 : 16;
        const ts: number[] = [0];
        if (flareAmt > 0 && tc > 0.02) ts.push(tc * 0.35, tc);
        if (inZone) { ts.push(0.15, 0.3, 0.5, 0.75); ts.sort((a, b) => a - b); }
        const turn = arc ? Math.abs(arc.angle) : curved ? Math.acos(clamp(T0[0] * T1[0] + T0[1] * T1[1] + T0[2] * T1[2], -1, 1)) : 0;
        const seg = arc ? clamp(Math.round(turn * 10), 4, 16) : curved ? clamp(Math.ceil(turn * 8) + 2, 3, 8) : 1;
        for (let k = 1; k <= seg; k++) if (k / seg > ts[ts.length - 1] + 0.03) ts.push(k / seg);
        if (ts[ts.length - 1] < 1) ts.push(1);
        const rough = isBark ? clamp((rb - 0.3) * 0.05, 0, 0.07) : 0;
        const tiles = Math.max(1, Math.round((6.2832 * rb) / 3.5));
        const v0 = (sh.id % 7) * 0.13;
        B.reserve(ts.length * (RN + 1) + 1, ts.length * RN * 6);
        let prev = -1;
        for (let q = 0; q < ts.length; q++) {
          const t = ts[q];
          at(t);
          let r = radiusAt(t), lobe = 0;
          if (inZone && cy < zone) { const f = 1 - Math.max(0, cy) / zone; r *= 1 + 1.1 * f * f; lobe = 0.28 * f; }
          const shade = (isBark ? 1 : 0.9 + 0.2 * rnd(sh.id, 5, q)) * ao;
          const first = B.nv;
          for (let k = 0; k <= RN; k++) {
            const a = (k / RN) * 6.2832, km = k % RN;
            const nx = u[0] * Math.cos(a) + w[0] * Math.sin(a), ny = u[1] * Math.cos(a) + w[1] * Math.sin(a), nz = u[2] * Math.cos(a) + w[2] * Math.sin(a);
            const rr = r * (1 + lobe * Math.sin(3 * a + 0.7) + rough * (rnd(sh.id, km, q + 20) - 0.5) * 2);
            B.v(cx + nx * rr, cy + ny * rr, cz + nz * rr, nx, ny, nz, col[0] * shade, col[1] * shade, col[2] * shade);
            B.t((k / RN) * tiles, v0 + (t * len) / 7);
          }
          if (prev >= 0) for (let k = 0; k < RN; k++) {
            B.tri(prev + k, prev + k + 1, first + k); B.tri(prev + k + 1, first + k + 1, first + k);
          }
          prev = first;
        }
        const cut = sh.tipCut && !sh.elong ? 0.2 : 0.8;
        const c = B.v(cx + d[0] * rt * cut, cy + d[1] * rt * cut, cz + d[2] * rt * cut, d[0], d[1], d[2],
          sh.tipCut ? 0.8 : col[0] * ao, sh.tipCut ? 0.7 : col[1] * ao, sh.tipCut ? 0.5 : col[2] * ao);
        B.t(0.5, v0 + len / 7);
        for (let k = 0; k < RN; k++) B.tri(prev + k, prev + k + 1, c);
      }

      if ((sh.wire || sh.scar) && len > 0.3) {
        // drát: měděná šroubovice o síle ~1/3 větve; po zarostlém drátu zůstane tmavá jizva
        const wr = sh.wire ? Math.max(0.035, rb / 3) : 0.02;
        const pitch = Math.max(0.45, rb * 3.2 + wr * 2);
        const steps = Math.min(240, Math.max(8, Math.round((len / pitch) * 8)));
        const [cr, cg, cb] = sh.wire ? (sh.scar ? [0.5, 0.3, 0.16] : [0.78, 0.48, 0.22]) : [0.27, 0.2, 0.16];
        wb.reserve((steps + 1) * 2, steps * 12);
        let prev = -1;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, a = (k / 8) * 6.2832 + sh.id;
          at(t);
          const rr = radiusAt(t) + (sh.wire && !sh.scar ? wr * 0.7 : 0.012);
          const nx = u[0] * Math.cos(a) + w[0] * Math.sin(a), ny = u[1] * Math.cos(a) + w[1] * Math.sin(a), nz = u[2] * Math.cos(a) + w[2] * Math.sin(a);
          const px = cx + nx * rr, py = cy + ny * rr, pz = cz + nz * rr;
          const v0 = wb.v(px - d[0] * wr, py - d[1] * wr, pz - d[2] * wr, nx, ny, nz, cr, cg, cb);
          wb.v(px + d[0] * wr, py + d[1] * wr, pz + d[2] * wr, nx, ny, nz, cr, cg, cb);
          if (prev >= 0) {
            wb.tri(prev, prev + 1, v0); wb.tri(prev + 1, v0 + 1, v0);
            wb.tri(prev, v0, prev + 1); wb.tri(prev + 1, v0, v0 + 1);
          }
          prev = v0;
        }
      }

      if (sh.dead) continue;

      // pupeny: vejčité, červenohnědé, se světlou zasmolenou špičkou
      const drawBud = (dir: Vec3, bl: number, off: number) => {
        const br = bl * 0.3;
        const ox = cx + dir[0] * off, oy = cy + dir[1] * off, oz = cz + dir[2] * off;
        const [bu, bw] = basis(dir);
        wb.reserve(3 * RAD + 1, 3 * RAD * 6);
        let prev = -1;
        for (const [t, r, cr, cg, cb] of [[0, 0.7, 0.5, 0.3, 0.2], [0.4, 1, 0.62, 0.36, 0.24], [0.78, 0.55, 0.7, 0.5, 0.36]] as number[][]) {
          const first = wb.nv;
          for (let k = 0; k < RAD; k++) {
            const a = (k / RAD) * 6.2832;
            const nx = bu[0] * Math.cos(a) + bw[0] * Math.sin(a), ny = bu[1] * Math.cos(a) + bw[1] * Math.sin(a), nz = bu[2] * Math.cos(a) + bw[2] * Math.sin(a);
            wb.v(ox + dir[0] * bl * t + nx * br * r, oy + dir[1] * bl * t + ny * br * r, oz + dir[2] * bl * t + nz * br * r, nx, ny, nz, cr, cg, cb);
          }
          if (prev >= 0) for (let k = 0; k < RAD; k++) {
            const k2 = (k + 1) % RAD;
            wb.tri(prev + k, prev + k2, first + k); wb.tri(prev + k2, first + k2, first + k);
          }
          prev = first;
        }
        const c = wb.v(ox + dir[0] * bl, oy + dir[1] * bl, oz + dir[2] * bl, dir[0], dir[1], dir[2], 0.82, 0.7, 0.55);
        for (let k = 0; k < RAD; k++) wb.tri(prev + k, prev + (k + 1) % RAD, c);
      };
      for (const b of sh.buds) {
        at(b.t);
        drawBud(b.dir, Math.min(1.5, 0.28 + 0.045 * b.len) * budG, b.kind === 'terminal' || b.t < 0.98 ? 0 : rt * 0.5);
      }
      // rašící svíčka: pupen nezmizí, ale protahuje se – na špičce svíčky zůstává, dokud nedoroste
      if (sh.elong && sh.kind === 'shoot' && !sh.tipCut) {
        const e = sh.targetLen > 0 ? len / sh.targetLen : 1;
        at(1);
        drawBud(d, Math.min(1.5, 0.28 + 0.045 * sh.targetLen) * (1.1 - 0.75 * e), 0);
      }

      // jehlice: osvětlené, vrhají a přijímají stín; uvnitř koruny tmavší podle oslunění ze simulace
      if (sh.needleCount <= 0 || sh.needleLive <= 0) continue;
      const g = needleGrowth(s, sh);
      const nl = sh.needleLen * g;
      if (nl < 0.03) continue;
      const cnt = sh.needleCount;
      const fasc = sh.kind === 'shoot';
      const perF = fasc ? 2 : 1;
      nb.reserve(Math.ceil(cnt / stride + 1) * perF * 3, Math.ceil(cnt / stride + 1) * perF * 6);
      let cr: number, cg: number, cb: number;
      if (sh.kind === 'hypocotyl') { cr = 0.42; cg = 0.6; cb = 0.3; }
      else if (sh.kind === 'epicotyl') { cr = 0.33; cg = 0.53; cb = 0.38; }
      else if (age === 0) { const k = g; cr = 0.5 - 0.2 * k; cg = 0.66 - 0.16 * k; cb = 0.3 - 0.02 * k; }
      else if (age === 1) { cr = 0.24; cg = 0.43; cb = 0.3; }
      else { cr = 0.21; cg = 0.37; cb = 0.28; }
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
        for (let q = 0; q < perF; q++) {
          const sgn = perF === 1 ? 0 : q === 0 ? -0.1 : 0.1;
          const nx = d[0] * ca + rx * sa + tx * sgn, ny = d[1] * ca + ry * sa + ty * sgn - 0.06, nz = d[2] * ca + rz * sa + tz * sgn;
          const a0 = nb.v(px - tx * nw * 0.5, py - ty * nw * 0.5, pz - tz * nw * 0.5, N[0], N[1], N[2], r * 0.7, gg * 0.7, b * 0.7);
          const a1 = nb.v(px + tx * nw * 0.5, py + ty * nw * 0.5, pz + tz * nw * 0.5, N[0], N[1], N[2], r * 0.7, gg * 0.7, b * 0.7);
          const a2 = nb.v(px + nx * L, py + ny * L, pz + nz * L, N[0], N[1], N[2], r * 1.15, gg * 1.15, b * 1.15);
          nb.tri(a0, a1, a2); nb.tri(a0, a2, a1);
        }
      }
    }

    wb.apply(this.wood.geometry, true);
    bb.apply(this.bark.geometry, true);
    nb.apply(this.needles.geometry, true);
    this.seedMesh.visible = s.stage === 'seed';
    this.updatePot(s.potId, H);
    // podložka musí pojmout nádobu i stín stromu
    const ps = potById(this.potOverride ?? s.potId);
    this.table.scale.setScalar(Math.max(Math.max(ps.a, ps.b) * 2.2, H * 1.7, 30));

    // slunce a rozsah stínové mapy podle velikosti stromu
    const R = Math.max(16, H * 1.2);
    const sc = this.sun.shadow.camera;
    this.sun.target.position.set(0, H * 0.4, 0);
    this.sun.position.set(0.48 * R * 3, H * 0.4 + 0.8 * R * 3, 0.36 * R * 3);
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.3; sc.far = R * 7;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = R * 0.004;
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
