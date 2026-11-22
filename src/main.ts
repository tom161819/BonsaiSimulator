// Aplikační vrstva: propojuje časovou osu (simulace) s 3D pohledem a ovládáním.

import { Timeline } from './sim/timeline';
import { TreeView, Pick } from './render/view';
import { P, POT, MAX_YEARS } from './sim/params';
import { MONTHS, dateOf } from './sim/climate';
import { YEAR, doyOf, stats, yearOf } from './sim/util';
import type { Action, ActionInput, PotType, State } from './sim/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE = 'bonsai-simulator-v1';
interface Save { seed: number; actions: Action[]; day: number }

function loadSave(): Save | null {
  const hot = (window as any).claude?.hot?.data;
  if (hot && typeof hot.seed === 'number') return hot as Save;
  try {
    const raw = localStorage.getItem(SAVE);
    if (raw) return JSON.parse(raw) as Save;
  } catch { /* úložiště nemusí být dostupné */ }
  return null;
}

let tl: Timeline;
let playing = false;
let speed = 7;
let acc = 0;
let hover: Pick | null = null;
let pending: Described | null = null;

const view = new TreeView($<HTMLCanvasElement>('scene'));

function start(save: Save | null) {
  tl = new Timeline(save?.seed ?? Math.floor(Math.random() * 1e9), save?.actions ?? []);
  if (save) tl.seek(save.day);
  view.recenter();
  refresh();
}

function persist() {
  try { localStorage.setItem(SAVE, JSON.stringify({ seed: tl.seed, actions: tl.actions, day: tl.day })); } catch { /* bez uložení */ }
}

// ---------------------------------------------------------------- texty

const fmtDate = (day: number) => {
  const d = dateOf(doyOf(day));
  return `${d.day}. ${MONTHS[d.month]} · ${yearOf(day) + 1}. rok`;
};
const cm = (x: number) => (x >= 100 ? `${(x / 100).toFixed(2).replace('.', ',')} m` : `${x.toFixed(1).replace('.', ',')} cm`);

function phase(s: State): { name: string; hint: string; season: string } {
  const doy = doyOf(s.day), year = yearOf(s.day);
  if (s.stage === 'seed') return { name: 'Semínko v zemi', hint: 'Vyseto 1. dubna. Vyklíčí, až se půda prohřeje – pusťte čas.', season: 'spring' };
  if (s.stage === 'dead') return { name: 'Strom odumřel', hint: 'Bez jehlic borovice nepřežije. Vraťte poslední zásah nebo se posuňte v čase zpět.', season: 'winter' };
  if (year === 0) {
    if (doy < 150) return { name: 'Klíčení', hint: 'Hypokotyl vynáší dělohy nad zem. První rok se nic nestříhá.', season: 'spring' };
    if (doy < P.seedlingBudSetDoy) return { name: 'Růst epikotylu', hint: 'Semenáček roste volně a nese jednotlivé primární jehlice.', season: 'summer' };
  }
  if (s.gdd < P.flushGdd && doy < 180) return { name: 'Vegetační klid', hint: 'Pupeny čekají na teplo. Vhodná doba na výběr pupenů a hrubý řez.', season: doy < 60 ? 'winter' : 'spring' };
  if (s.gdd < P.flushGdd + P.elongSpanGdd + 40 && doy < 200 && year > 0)
    return { name: 'Prodlužování svíček', hint: 'Teď se zaštipují svíčky: kliknutím na svíčku ji zkrátíte. Zkrácený výhon doroste jen ze zbylé části.', season: 'spring' };
  if (s.gdd < P.budSetGdd && doy < 220) return { name: 'Vyzrávání letorostů', hint: 'Jehlice ještě dorůstají. Řez letorostu teď vyvolá nové pupeny ještě letos.', season: 'summer' };
  if (doy < P.shedStartDoy) return { name: 'Zakládání pupenů', hint: 'V pupenech se rozhoduje o délce příštích výhonů. Řez po tomto termínu už letos pupeny nevytvoří.', season: 'summer' };
  if (doy < P.shedEndDoy) return { name: 'Opad starých jehlic', hint: 'Nejstarší ročník jehlic žloutne a opadává. Doba na výběr pupenů – vylomte přebytečné.', season: 'autumn' };
  return { name: 'Vegetační klid', hint: 'Strom odpočívá. Vhodná doba na výběr pupenů a hrubý řez.', season: doy > 330 ? 'winter' : 'autumn' };
}

interface Described { title: string; detail: string; danger: string; action: ActionInput; pick: Pick }

/** Popíše, co zásah v daném místě udělá – ještě před kliknutím. */
function describe(p: Pick): Described | null {
  const s = tl.state;
  const sh = s.shoots.find((x) => x.id === p.shoot);
  if (!sh) return null;
  if (p.type === 'bud') {
    const b = sh.buds.find((x) => x.id === p.bud);
    if (!b) return null;
    const kind = b.kind === 'terminal' ? 'terminální' : b.kind === 'back' ? 'zpětný' : 'boční';
    const last = sh.buds.length === 1 && !(sh.needleCount > 0 && sh.needleLive > 0.02);
    return {
      title: `Vylomit ${kind} pupen`, detail: `Na jaře by z něj vyrostl výhon asi ${cm(b.len)}.`,
      danger: last ? 'Poslední pupen na výhonu bez jehlic – výhon odumře.' : '',
      action: { type: 'bud', shoot: sh.id, bud: b.id, label: `Vylomen ${kind} pupen` }, pick: p,
    };
  }
  let t = Math.round(p.t * 20) / 20;
  if (sh.dead) t = 0;
  else if (sh.parent >= 0 && t < 0.1) t = 0;
  else t = Math.min(0.95, Math.max(sh.parent < 0 ? 0.15 : 0.1, t));
  const gone = new Set<number>([-2]);
  let sub = 0;
  for (const c of s.shoots) {
    if ((c.parent === sh.id && c.attachT > t) || gone.has(c.parent)) { gone.add(c.id); sub++; }
  }
  const plus = sub ? ` Odstraní se i ${sub} navazujících výhonů.` : '';
  const pick: Pick = { type: 'shoot', shoot: sh.id, t };
  if (t === 0) {
    return {
      title: sh.dead ? 'Odstranit suchou větev' : sub ? 'Odstranit celou větev' : 'Odstranit celý výhon', detail: `Řez u báze.${plus}`,
      danger: '', action: { type: 'cut', shoot: sh.id, t: 0, label: sh.dead ? 'Odstraněna suchá větev' : 'Odstraněna větev' }, pick,
    };
  }
  const bare = sh.kind === 'shoot' ? P.bareBase : 0;
  const needlesLeft = sh.kind !== 'hypocotyl' && sh.needleLive > 0.02 && Math.round((sh.needleCount * Math.max(0, t - bare)) / (1 - bare)) > 0;
  const kidsLeft = s.shoots.some((c) => c.parent === sh.id && c.attachT <= t && !c.dead) || sh.buds.some((b) => b.t <= t);
  const danger = needlesLeft || kidsLeft ? '' : 'Pod řezem nezůstanou žádné jehlice – výhon odumře. Borovice z holého dřeva neobráží.';
  const pct = Math.round((1 - t) * 100);
  if (sh.elong && sh.kind === 'shoot') {
    return {
      title: 'Zaštípnout svíčku', detail: `Odstraní ${pct} %. Zbytek doroste na ${cm(sh.targetLen * t)} místo ${cm(sh.targetLen)}; u řezu se v létě založí několik menších pupenů.${plus}`,
      danger, action: { type: 'cut', shoot: sh.id, t, label: `Zaštípnuta svíčka o ${pct} %` }, pick,
    };
  }
  const when = !needlesLeft ? '' : s.budSetYear < yearOf(s.day) ? ' Nové pupeny u řezu se založí ještě letos v létě.' : ' Nové pupeny u řezu se založí až příští léto.';
  return {
    title: sub ? 'Zkrátit větev' : 'Zkrátit výhon', detail: `Zůstane ${cm(sh.len * t)} z ${cm(sh.len)}.${plus}${when}`,
    danger, action: { type: 'cut', shoot: sh.id, t, label: sub ? `Zkrácena větev o ${pct} %` : `Zkrácen výhon o ${pct} %` }, pick,
  };
}

// ---------------------------------------------------------------- UI

const slider = $<HTMLInputElement>('slider');

function buildTrack() {
  slider.min = String(tl.minDay); slider.max = String(tl.maxDay); slider.step = '1';
  const years = $('years');
  years.innerHTML = '';
  const span = tl.maxDay - tl.minDay;
  for (let y = 1; y <= MAX_YEARS - 2; y += y === 1 ? 4 : 5) {
    const el = document.createElement('span');
    el.textContent = `${y}. rok`;
    el.style.left = `${(((y - 1) * YEAR + 180 - tl.minDay) / span) * 100}%`;
    years.appendChild(el);
  }
}

function refreshLog() {
  const log = $('log');
  log.innerHTML = '';
  const marks = $('marks');
  marks.innerHTML = '';
  const span = tl.maxDay - tl.minDay;
  if (!tl.actions.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Zatím bez zásahů. Najeďte myší na výhon nebo pupen a klikněte.';
    log.appendChild(li);
  }
  for (const a of [...tl.actions].reverse()) {
    const li = document.createElement('li');
    if (a.day > tl.day) li.className = 'future';
    const b = document.createElement('button');
    b.textContent = a.label || a.type;
    const sp = document.createElement('span');
    sp.textContent = fmtDate(a.day);
    b.appendChild(sp);
    b.onclick = () => { playing = false; tl.seek(a.day); refresh(); };
    li.appendChild(b);
    log.appendChild(li);
    const m = document.createElement('i');
    m.style.left = `${((a.day - tl.minDay) / span) * 100}%`;
    marks.appendChild(m);
  }
  $<HTMLButtonElement>('undo').disabled = !tl.actions.length;
}

let lastLogKey = '';
function refresh() {
  const s = tl.state;
  view.setState(s);
  setHover(null);
  const st = stats(s);
  const ph = phase(s);
  $('date').textContent = fmtDate(s.day);
  $('phaseName').textContent = ph.name;
  const fut = tl.futureActions();
  $('hint').textContent = fut ? `Jste v minulosti: nový zásah přepíše ${fut} pozdějších zásahů v deníku.` : ph.hint;
  $('season').style.setProperty('--season', `var(--${ph.season})`);
  $('sHeight').textContent = s.stage === 'seed' ? '–' : cm(st.height);
  $('sDia').textContent = s.stage === 'seed' ? '–' : `${(st.baseDiameter * 10).toFixed(1).replace('.', ',')} mm`;
  $('sShoots').textContent = String(st.shoots);
  $('sBuds').textContent = String(st.buds);
  $('sNeedles').textContent = st.needles.toLocaleString('cs-CZ');
  $('sGdd').textContent = `${Math.round(s.gdd)} d.d.`;
  slider.value = String(s.day);
  for (const b of $('pots').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.pot === s.pot));
  $('play').textContent = playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Pozastavit čas' : 'Spustit čas');
  const banner = $('banner');
  banner.hidden = s.stage !== 'dead';
  if (s.stage === 'dead') banner.textContent = 'Strom odumřel – nezůstaly mu žádné jehlice. Vraťte poslední zásah.';
  const key = `${tl.actions.length}:${tl.actions.filter((a) => a.day > s.day).length}`;
  if (key !== lastLogKey) { lastLogKey = key; refreshLog(); }
}

const tip = $('tip');
function setHover(d: Described | null, x = 0, y = 0, touch = false) {
  hover = d ? d.pick : null;
  pending = touch ? d : null;
  view.highlight(hover);
  if (!d) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.className = d.danger ? 'danger' : '';
  tip.innerHTML = '';
  const b = document.createElement('b'); b.textContent = d.title;
  const t = document.createElement('span'); t.textContent = d.detail;
  tip.append(b, t);
  if (d.danger) { const e = document.createElement('em'); e.textContent = d.danger; tip.appendChild(e); }
  if (touch) {
    const btn = document.createElement('button');
    btn.className = 'primary'; btn.textContent = 'Provést';
    btn.onclick = () => { if (pending) doAction(pending); };
    tip.appendChild(btn);
  }
  const W = window.innerWidth, H = window.innerHeight;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(W - r.width - 8, x + 16))}px`;
  tip.style.top = `${Math.max(8, Math.min(H - r.height - 8, y + 16))}px`;
}

function doAction(d: Described) {
  tl.act(d.action);
  lastLogKey = '';
  persist();
  refresh();
}

// ---------------------------------------------------------------- ukazatel

const canvas = view.canvas;
const pointers = new Map<number, { x: number; y: number }>();
let downAt: { x: number; y: number; button: number } | null = null;
let moved = 0;
let pinch = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downAt = { x: e.clientX, y: e.clientY, button: e.button };
  moved = 0;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev && pointers.size === 2) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) view.zoom(pinch / d);
    pinch = d; moved = 99;
    return;
  }
  if (prev && downAt) {
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    moved += Math.abs(dx) + Math.abs(dy);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (moved > 5) {
      if (downAt.button === 2 || e.shiftKey) view.pan(dx, dy); else view.orbit(dx, dy);
      if (hover) setHover(null);
    }
    return;
  }
  if (e.pointerType === 'mouse') {
    const p = view.pick(e.offsetX, e.offsetY);
    setHover(p ? describe(p) : null, e.clientX, e.clientY);
  }
});
const up = (e: PointerEvent) => {
  const wasTap = downAt && moved <= 5 && pointers.size === 1 && downAt.button === 0;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (!pointers.size) downAt = null;
  if (!wasTap) return;
  const p = view.pick(e.offsetX, e.offsetY);
  const d = p ? describe(p) : null;
  if (e.pointerType === 'mouse') { if (d) doAction(d); }
  else setHover(d, e.clientX, e.clientY, true);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); downAt = null; });
canvas.addEventListener('pointerleave', () => { if (!pending) setHover(null); });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
window.addEventListener('resize', () => view.resize());

// ---------------------------------------------------------------- ovládání času

function go(day: number) { tl.seek(day); refresh(); }
$('play').onclick = () => { playing = !playing; acc = 0; refresh(); };
for (const b of $('speeds').querySelectorAll('button')) {
  b.onclick = () => { speed = Number(b.dataset.speed); syncSpeed(); };
}
function syncSpeed() {
  for (const b of $('speeds').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-jump]')) b.onclick = () => go(tl.day + Number(b.dataset.jump));
$('j-spring').onclick = () => {
  // krokujeme, dokud nevyraší nové svíčky, a přidáme pár dní, aby byly vidět
  const f0 = tl.state.flushedYear;
  while (tl.day < tl.maxDay && tl.state.flushedYear === f0) tl.seek(tl.day + 1);
  tl.seek(tl.day + 6);
  refresh();
};
slider.oninput = () => { playing = false; go(Number(slider.value)); };
for (const b of $('pots').querySelectorAll('button')) {
  b.onclick = () => {
    const pot = b.dataset.pot as PotType;
    if (pot === tl.state.pot) return;
    doAction({ title: '', detail: '', danger: '', pick: { type: 'shoot', shoot: -1, t: 0 }, action: { type: 'repot', pot, label: `Přesazeno: ${POT[pot].name.toLowerCase()}` } });
  };
}
$('undo').onclick = () => { tl.undo(); lastLogKey = ''; persist(); refresh(); };
$('center').onclick = () => view.recenter();
$('moreBtn').onclick = () => document.body.classList.toggle('more');
let resetArmed = 0;
$('reset').onclick = () => {
  if (Date.now() - resetArmed < 4000) {
    $('reset').textContent = 'Nové semínko';
    resetArmed = 0; lastLogKey = '';
    start(null); buildTrack(); persist();
  } else {
    resetArmed = Date.now();
    $('reset').textContent = 'Opravdu? Smaže deník';
    setTimeout(() => { $('reset').textContent = 'Nové semínko'; }, 4000);
  }
};
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('undo').click(); }
});

let last = performance.now();
let lastSave = 0;
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    const s = tl.state;
    const doy = doyOf(s.day);
    const dormant = s.stage !== 'seed' && (doy > P.shedEndDoy + 5 || s.gdd < P.flushGdd - 25) ? 4 : 1; // zima běží rychleji
    acc += dt * speed * dormant;
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      if (tl.day + n >= tl.maxDay) playing = false;
      go(tl.day + n);
      if (now - lastSave > 3000) { lastSave = now; persist(); }
    }
  }
  view.frame();
  requestAnimationFrame(loop);
}

const hot = (window as any).claude?.hot;
hot?.snapshot?.(() => ({ seed: tl.seed, actions: tl.actions, day: tl.day }));
start(loadSave());
buildTrack();
syncSpeed();
refresh();
requestAnimationFrame(loop);
