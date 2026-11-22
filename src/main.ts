// Aplikační vrstva: propojuje časovou osu (simulace) s 3D pohledem a ovládáním.

import { Timeline } from './sim/timeline';
import { TreeView, Pick } from './render/view';
import { P, POT, POTS, MAX_YEARS, potById } from './sim/params';
import { MONTHS, dateOf } from './sim/climate';
import { YEAR, bendLimit, breakRisk, doyOf, potCapFor, radiusOf, repotSeason, repotStress, rootFill, stats, yearOf } from './sim/util';
import type { Action, ActionInput, PotType, State } from './sim/types';
import { bendShoot } from './sim/actions';

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
let tool: 'cut' | 'wire' = 'cut';
let repotOpen = false;

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
  if (s.stage === 'dead') return { name: 'Strom odumřel', hint: 'Bez jehlic nebo po příliš tvrdém přesazení borovice nepřežije. Vraťte poslední zásah nebo se posuňte v čase zpět.', season: 'winter' };
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

/** Sloupec období: v prvním roce vývoj semenáčku, pak roční cyklus stromu. Názvy odpovídají phase(). */
const PHASES_SEEDLING: [string, string][] = [
  ['Semínko v zemi', 'duben'], ['Klíčení', 'duben–květen'], ['Růst epikotylu', 'červen–srpen'],
  ['Zakládání pupenů', 'srpen–září'], ['Opad starých jehlic', 'září–říjen'], ['Vegetační klid', 'listopad–duben'],
];
const PHASES_TREE: [string, string][] = [
  ['Vegetační klid', 'listopad–duben'], ['Prodlužování svíček', 'duben–červen'], ['Vyzrávání letorostů', 'červen–červenec'],
  ['Zakládání pupenů', 'červenec–září'], ['Opad starých jehlic', 'září–říjen'],
];
let phaseKey = '';
function refreshPhases(s: State, active: string) {
  const list = yearOf(s.day) === 0 ? PHASES_SEEDLING : PHASES_TREE;
  const key = `${list === PHASES_SEEDLING ? 's' : 't'}:${active}`;
  if (key === phaseKey) return;
  phaseKey = key;
  const ol = $('phaseList');
  ol.innerHTML = '';
  for (const [name, months] of list) {
    const li = document.createElement('li');
    li.textContent = name;
    const sp = document.createElement('span');
    sp.textContent = months;
    li.appendChild(sp);
    if (name === active) { li.className = 'on'; li.setAttribute('aria-current', 'step'); }
    ol.appendChild(li);
  }
}

interface Described { title: string; detail: string; danger: string; action: ActionInput | null; pick: Pick }

const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/** Nástroj Drát: co jde s větví udělat. */
function describeWire(p: Pick): Described | null {
  const s = tl.state;
  const sh = s.shoots.find((x) => x.id === p.shoot);
  if (!sh || sh.dead) return null;
  const pick: Pick = { type: 'shoot', shoot: sh.id, t: 0 };
  if (sh.wire) {
    const hold = Math.round(sh.wire.set * 100);
    return {
      title: 'Sundat drát', pick,
      detail: `Tvar zatím drží z ${hold} %${hold < 100 ? ' – zbytek ohybu se vrátí' : ''}. Tažením můžete větev doohnout.`,
      danger: sh.scar ? 'Drát už zarostl do kůry a nechá jizvu.' : '',
      action: { type: 'unwire', shoot: sh.id, label: `Sundán drát (tvar držel z ${hold} %)` },
    };
  }
  if (sh.parent < 0) return { title: 'Kmen u země', detail: 'Sklon celého stromu se mění při přesazení, ne drátem.', danger: '', action: null, pick };
  if (sh.elong) return { title: 'Svíčka je příliš měkká', detail: 'Drátuje se až vyzrálý výhon.', danger: '', action: null, pick };
  const spring = s.gdd >= P.flushGdd && s.gdd < P.budSetGdd;
  return {
    title: 'Nadrátovat a ohnout', pick,
    detail: `Táhněte větev tam, kam ji chcete ohnout. Bezpečný ohyb do ${deg(bendLimit(s, sh, arcZ()))}°, měděný drát ø ${(radiusOf(sh) * 20 / 3).toFixed(1).replace('.', ',')} mm.`,
    danger: spring ? 'Strom je v růstu a kůra se snadno odlupuje – větve teď praskají dřív. Lepší je podzim až předjaří.' : '',
    action: null,
  };
}

/** Popíše, co zásah v daném místě udělá – ještě před kliknutím. */
function describe(p: Pick): Described | null {
  if (tool === 'wire') return describeWire(p);
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
  refreshPhases(s, ph.name);
  const fut = tl.futureActions();
  const fill = rootFill(s);
  const wires = s.shoots.filter((x) => x.wire);
  const biting = wires.filter((x) => x.scar).length;
  const ready = wires.filter((x) => x.wire!.set >= 1).length;
  let hint = ph.hint;
  if (s.stage === 'growing') {
    if (s.stress > 0.45) hint = 'Strom se vzpamatovává z přesazení – letos poroste slabě. Nestříhejte a nepřesazujte.';
    else if (fill > 1.2) hint = 'Kořeny přerostly nádobu: voda neprotéká, strom slábne a bez přesazení se zakrácením kořenů bude chřadnout.';
    else if (biting) hint = `Drát na ${biting} ${biting === 1 ? 'větvi' : 'větvích'} zarůstá do kůry. Sundejte ho nástrojem Drát.`;
    else if (fill > P.rootBoundStart) hint = 'Nádoba je prokořeněná a růst začíná slábnout. Naplánujte přesazení na předjaří.';
    else if (ready) hint = `${ready} ${ready === 1 ? 'nadrátovaná větev už drží' : 'nadrátované větve už drží'} tvar – drát lze sundat.`;
  }
  $('hint').textContent = fut ? `Jste v minulosti: nový zásah přepíše ${fut} pozdějších zásahů v deníku.` : hint;
  const sr = $('sRoots');
  sr.textContent = s.pot === 'ground' ? 'volná půda' : `${String(potById(s.potId).liters).replace('.', ',')} l · ${Math.round(fill * 100)} %`;
  sr.title = potById(s.potId).name;
  sr.className = fill > 1.2 ? 'bad' : '';
  const sw = $('sWires');
  sw.textContent = wires.length ? `${wires.length}${biting ? ` · ${biting} zarůstá` : ''}` : '–';
  sw.className = biting ? 'bad' : '';
  $('season').style.setProperty('--season', `var(--${ph.season})`);
  $('sHeight').textContent = s.stage === 'seed' ? '–' : cm(st.height);
  $('sDia').textContent = s.stage === 'seed' ? '–' : `${(st.baseDiameter * 10).toFixed(1).replace('.', ',')} mm`;
  $('sShoots').textContent = String(st.shoots);
  $('sBuds').textContent = String(st.buds);
  $('sNeedles').textContent = st.needles.toLocaleString('cs-CZ');
  $('sGdd').textContent = `${Math.round(s.gdd)} d.d.`;
  slider.value = String(s.day);
  for (const b of $('toolSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  if (repotOpen) updateRepot();
  $('wireOpts').hidden = tool !== 'wire';
  $<HTMLButtonElement>('unwireAll').disabled = !s.shoots.some((x) => x.wire);
  $('play').textContent = playing ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', playing ? 'Pozastavit čas' : 'Spustit čas');
  const banner = $('banner');
  if (s.stage === 'dead') banner.hidden = false; else if (!flashTimer) banner.hidden = true;
  if (s.stage === 'dead') banner.textContent = 'Strom odumřel. Vraťte poslední zásah nebo se posuňte v čase zpět.';
  const key = `${tl.actions.length}:${tl.actions.filter((a) => a.day > s.day).length}`;
  if (key !== lastLogKey) { lastLogKey = key; refreshLog(); }
}

const tip = $('tip');
function setHover(d: Described | null, x = 0, y = 0, touch = false) {
  hover = d ? d.pick : null;
  pending = touch ? d : null;
  view.highlight(hover, tool === 'wire' ? 0xd98324 : 0xff3b1f);
  if (!d) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.className = d.danger ? 'danger' : '';
  tip.innerHTML = '';
  const b = document.createElement('b'); b.textContent = d.title;
  const t = document.createElement('span'); t.textContent = d.detail;
  tip.append(b, t);
  if (d.danger) { const e = document.createElement('em'); e.textContent = d.danger; tip.appendChild(e); }
  if (touch && d.action) {
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
  if (!d.action) return;
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
let bend: { id: number; axis: [number, number, number]; angle: number; z: number } | null = null;
const arcZ = () => Number($<HTMLInputElement>('wArc').value) / 100;
function syncArc() {
  const z = arcZ();
  $('wArcV').textContent = z === 0 ? 'ostrý zlom v nasazení' : z === 1 ? 'oblouk po celé délce' : `oblouk přes ${Math.round(z * 100)} % délky`;
}
$<HTMLInputElement>('wArc').oninput = syncArc;
syncArc();

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  downAt = { x: e.clientX, y: e.clientY, button: e.button };
  moved = 0;
  bend = null;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  else if (tool === 'wire' && e.button === 0 && !repotOpen) {
    // tažení za větev = ohyb drátem; tažení mimo strom otáčí pohled
    const p = view.pick(e.offsetX, e.offsetY);
    const sh = p && tl.state.shoots.find((x) => x.id === p.shoot);
    if (sh && !sh.dead && !sh.elong && sh.parent >= 0) bend = { id: sh.id, axis: [0, 1, 0], angle: 0, z: arcZ() };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev && pointers.size === 2) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) view.zoom(pinch / d);
    pinch = d; moved = 99; bend = null;
    return;
  }
  if (prev && downAt) {
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    moved += Math.abs(dx) + Math.abs(dy);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (moved <= 5) return;
    if (bend) {
      const sh = tl.state.shoots.find((x) => x.id === bend!.id)!;
      const tgt = view.bendTarget(bend.id, e.offsetX, e.offsetY);
      if (tgt) {
        const z = bend.z;
        const safe = bendLimit(tl.state, sh, z);
        bend.axis = tgt.axis;
        // kurzor určuje směr špičky; u oblouku je celkové stočení větší než úhel tětivy
        bend.angle = Math.min(tgt.angle / (1 - z / 2), safe * 1.5);
        const risk = breakRisk(tl.state, sh, bend.angle, z);
        const tmp = structuredClone(tl.state);
        bendShoot(tmp, bend.id, bend.axis, bend.angle, z);
        view.previewState(tmp, bend.id, risk > 0);
        const radius = z > 0 && bend.angle > 0.01 ? ` · poloměr ${cm((z * sh.len) / bend.angle)}` : '';
        tip.hidden = false;
        tip.className = risk > 0 ? 'danger' : '';
        tip.textContent = risk > 0
          ? `Ohyb ${deg(bend.angle)}°${radius} · riziko prasknutí ${Math.round(risk * 100)} % (bezpečně do ${deg(safe)}°)`
          : `Ohyb ${deg(bend.angle)}°${radius} · bezpečně do ${deg(safe)}°`;
        tip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 16)}px`;
        tip.style.top = `${Math.max(8, e.clientY - 44)}px`;
      }
      return;
    }
    if (downAt.button === 2 || e.shiftKey) view.pan(dx, dy); else view.orbit(dx, dy);
    if (hover) setHover(null);
    return;
  }
  if (e.pointerType === 'mouse' && !repotOpen) {
    const p = view.pick(e.offsetX, e.offsetY);
    setHover(p ? describe(p) : null, e.clientX, e.clientY);
  }
});
const up = (e: PointerEvent) => {
  const wasTap = downAt && moved <= 5 && pointers.size === 1 && downAt.button === 0;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (!pointers.size) downAt = null;
  if (bend && !wasTap) {
    const b = bend;
    bend = null;
    setHover(null);
    if (b.angle > 0.05) {
      tl.act({ type: 'wire', shoot: b.id, axis: b.axis, angle: b.angle, z: b.z });
      const broke = tl.state.shoots.find((x) => x.id === b.id)?.dead;
      tl.actions[tl.actions.length - 1].label = broke ? `Větev při ohybu o ${deg(b.angle)}° praskla` : `Nadrátováno, ${b.z > 0 ? 'oblouk' : 'ohyb'} o ${deg(b.angle)}°`;
      lastLogKey = '';
      persist();
      refresh();
      if (broke) flash('Větev praskla a odumře. Zásah můžete vrátit.');
    }
    return;
  }
  bend = null;
  if (!wasTap || repotOpen) return;
  const p = view.pick(e.offsetX, e.offsetY);
  const d = p ? describe(p) : null;
  if (e.pointerType === 'mouse') { if (d) doAction(d); }
  else setHover(d, e.clientX, e.clientY, true);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); downAt = null; bend = null; });
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
// --- nástroje a přesazení
for (const b of $('toolSeg').querySelectorAll('button')) {
  b.onclick = () => { tool = b.dataset.tool as 'cut' | 'wire'; canvas.style.cursor = tool === 'wire' ? 'grab' : 'crosshair'; setHover(null); refresh(); };
}
// najetí na tlačítko Drát nebo na řádek „Dráty“ zvýrazní všechny dráty na stromu
for (const el of [$('tool-wire'), $('sWires'), $('sWires').previousElementSibling as HTMLElement]) {
  el.addEventListener('pointerenter', () => view.showWires(true));
  el.addEventListener('pointerleave', () => view.showWires(false));
  el.addEventListener('focus', () => view.showWires(true));
  el.addEventListener('blur', () => view.showWires(false));
}
$('unwireAll').onclick = () => {
  const cnt = tl.state.shoots.filter((x) => x.wire).length;
  if (!cnt) return;
  tl.act({ type: 'unwireAll', label: `Sundány všechny dráty (${cnt})` });
  lastLogKey = '';
  persist();
  refresh();
};
let flashTimer = 0;
function flash(text: string) {
  const el = $('banner');
  el.textContent = text; el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { flashTimer = 0; if (tl.state.stage !== 'dead') el.hidden = true; }, 4500);
}

let rPot = 't05';
{
  // nabídka nádob po skupinách
  const sel = $<HTMLSelectElement>('rPotSel');
  for (const type of ['ground', 'training', 'bonsai'] as PotType[]) {
    const grp = document.createElement('optgroup');
    grp.label = POT[type].name;
    for (const p of POTS.filter((x) => x.type === type)) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      grp.appendChild(o);
    }
    sel.appendChild(grp);
  }
  sel.onchange = () => { rPot = sel.value; updateRepot(); };
}
const rIn = (id: string) => $<HTMLInputElement>(id);
const rVals = () => ({ prune: Number(rIn('rPrune').value) / 100, yaw: Number(rIn('rYaw').value), side: Number(rIn('rSide').value), fwd: Number(rIn('rFwd').value), spread: Number(rIn('rSpread').value) / 100 });

function updateRepot() {
  const s = tl.state, v = rVals();
  const spec = potById(rPot);
  $<HTMLSelectElement>('rPotSel').value = rPot;
  view.previewPot(rPot);
  $('rPruneV').textContent = `${Math.round(v.prune * 100)} %`;
  $('rYawV').textContent = `${v.yaw}°`;
  $('rSideV').textContent = v.side ? `${Math.abs(v.side)}° ${v.side < 0 ? 'vlevo' : 'vpravo'}` : '0°';
  $('rSpreadV').textContent = `${Math.round(v.spread * 100)} %`;
  $('rFwdV').textContent = v.fwd ? `${Math.abs(v.fwd)}° ${v.fwd < 0 ? 'dozadu' : 'dopředu'}` : '0°';
  view.previewRotation(v.yaw, v.fwd, -v.side);
  const info = $('rInfo');
  info.innerHTML = '';
  const line = (t: string, bad = false) => { const e = document.createElement(bad ? 'b' : 'span'); e.textContent = t + ' '; if (bad) e.className = 'bad'; info.appendChild(e); };
  if (s.stage === 'seed') { line('Semínko zatím nevyklíčilo – nádobu lze zvolit bez rizika.'); $<HTMLButtonElement>('rOk').disabled = false; return; }
  const season = repotSeason(s);
  const total = s.stress + repotStress(s, v.prune);
  const after = spec.type === 'ground' ? 0 : (s.roots * (1 - v.prune)) / potCapFor(rPot);
  if (spec.type === 'ground') line('Ve volné půdě kořeny nic neomezuje – strom sílí nejrychleji, ale roste do výšky a jehlice má dlouhé.');
  else {
    line(`Kořeny teď zaplňují nádobu z ${Math.round(rootFill(s) * 100)} %, v nové (${String(spec.liters).replace('.', ',')} l) zaplní ${Math.round(after * 100)} %.`);
    if (after > 1.2) line('Kořeny se do této nádoby nevejdou – zakraťte je víc nebo zvolte větší.', true);
    else if (after > P.rootBoundStart) line('Nádoba bude hned těsná – zakraťte kořeny víc nebo zvolte větší.', true);
  }
  line(`Termín: ${season.name}.`, season.k > 1.5);
  if (total >= 1) line('Takový zásah strom nepřežije.', true);
  else if (total > 0.7) line('Stres vysoký: příští rok skoro neporoste.', true);
  else if (total > 0.4) line('Stres střední: růst příští rok znatelně zeslábne.');
  else line('Stres nízký.');
  if (v.prune > 0.5) line('Borovice žije s houbami na kořenech (mykorhiza). Část kořenového balu má vždy zůstat netknutá.');
}

function closeRepot() {
  repotOpen = false;
  $('repot').hidden = true;
  view.previewRotation(0, 0, 0);
  view.previewPot(null);
  refresh();
}
$('repotBtn').onclick = () => {
  if (repotOpen) { closeRepot(); return; }
  repotOpen = true; playing = false;
  rPot = tl.state.potId;
  rIn('rPrune').value = tl.state.pot === 'ground' || tl.state.stage === 'seed' ? '0' : '30';
  rIn('rYaw').value = '0'; rIn('rSide').value = '0'; rIn('rFwd').value = '0'; rIn('rSpread').value = '0';
  $('repot').hidden = false;
  view.front();
  setHover(null);
  refresh();
};
for (const id of ['rPrune', 'rYaw', 'rSide', 'rFwd', 'rSpread']) rIn(id).oninput = updateRepot;
$('rCancel').onclick = closeRepot;
$('rOk').onclick = () => {
  const v = rVals();
  const spec = potById(rPot);
  const parts = [spec.name.toLowerCase()];
  if (v.prune) parts.push(`kořeny −${Math.round(v.prune * 100)} %`);
  if (v.yaw) parts.push(`otočení ${v.yaw}°`);
  if (v.side || v.fwd) parts.push(`náklon ${Math.round(Math.hypot(v.side, v.fwd))}°`);
  if (v.spread) parts.push('kořeny rozprostřeny');
  tl.act({ type: 'repot', pot: spec.type, potId: spec.id, prune: v.prune, yaw: v.yaw, tiltX: v.fwd, tiltZ: -v.side, spread: v.spread, label: `Přesazeno: ${parts.join(', ')}` });
  lastLogKey = '';
  persist();
  closeRepot();
};
$('undo').onclick = () => { tl.undo(); lastLogKey = ''; persist(); refresh(); };
$('center').onclick = () => view.recenter();
let windOn = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const syncWind = () => { view.setWind(windOn); $('wind').setAttribute('aria-pressed', String(windOn)); };
$('wind').onclick = () => { windOn = !windOn; syncWind(); };
syncWind();
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
