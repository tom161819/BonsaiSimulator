// Aplikační vrstva: propojuje časovou osu (simulace) s 3D pohledem a ovládáním.

import { Timeline } from './sim/timeline';
import { TreeView, Pick, wireGauge } from './render/view';
import { GLAZES, P, POT, POTS, MAX_YEARS, RULES_LATEST, potById } from './sim/params';
import { MONTHS, dateOf } from './sim/climate';
import { YEAR, bendLimit, bendStress, breakRisk, heldArc, doyOf, potCapFor, radiusOf, repotSeason, repotStress, rootFill, stats, yearOf } from './sim/util';
import type { Action, ActionInput, PotType, State } from './sim/types';
import { bendShoot, deadwood, wholeBranch } from './sim/actions';
import { SPECIES, SPECIES_ORDER, speciesOf } from './sim/species';
import samplesJson from './samples.json';
import sampleThumbs from './sampleThumbs.json';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE = 'bonsai-simulator-v1';
/** rules = verze pravidel růstu; hry uložené před zavedením verzí ji nemají a rostly podle v1 */
interface Save { seed: number; actions: Action[]; day: number; rules?: number; species?: string }

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
type Tool = 'cut' | 'bud' | 'wire'; // bud = pinzeta: zasahuje jen pupeny
let tool: Tool = 'cut';
let repotOpen = false;

const view = new TreeView($<HTMLCanvasElement>('scene'));

function start(save: Save | null) {
  tl = new Timeline(save?.seed ?? Math.floor(Math.random() * 1e9), save?.actions ?? [], save ? save.rules ?? 1 : RULES_LATEST, save?.species ?? 'pine');
  $<HTMLSelectElement>('rules').value = String(tl.rules);
  if (save) tl.seek(save.day);
  view.recenter();
  refresh();
}

function persist() {
  try { localStorage.setItem(SAVE, JSON.stringify({ seed: tl.seed, actions: tl.actions, day: tl.day, rules: tl.rules, species: tl.species })); } catch { /* bez uložení */ }
}

// ---------------------------------------------------------------- texty

const fmtDate = (day: number) => {
  const d = dateOf(doyOf(day));
  return `${d.day}. ${MONTHS[d.month]} · ${yearOf(day) + 1}. rok`;
};
const cm = (x: number) => (x >= 100 ? `${(x / 100).toFixed(2).replace('.', ',')} m` : `${x.toFixed(1).replace('.', ',')} cm`);

function phase(s: State): { name: string; hint: string; season: string } {
  const doy = doyOf(s.day), year = yearOf(s.day);
  const sp = speciesOf(s), leafy = sp.kind === 'leafy';
  if (s.stage === 'seed') return { name: 'Semínko v zemi', hint: 'Vyseto 1. dubna. Vyklíčí, až se půda prohřeje – pusťte čas.', season: 'spring' };
  if (s.stage === 'dead') return { name: 'Strom odumřel', hint: 'Strom nepřežil – přišel o všechno živé nebo nevydržel příliš tvrdé přesazení. Vraťte poslední zásah nebo se posuňte v čase zpět.', season: 'winter' };
  if (year === 0) {
    if (doy < 150) return { name: 'Klíčení', hint: sp.hypogeal ? 'Žalud klíčí pod zemí, dělohy zůstávají v něm. První rok se nic nestříhá.' : 'Hypokotyl vynáší dělohy nad zem. První rok se nic nestříhá.', season: 'spring' };
    if (doy < P.seedlingBudSetDoy) return { name: 'Růst epikotylu', hint: leafy ? 'Semenáček roste volně a rozvíjí první pravé listy.' : 'Semenáček roste volně a nese jednotlivé primární jehlice.', season: 'summer' };
  }
  const flushGdd = leafy ? sp.flushGdd : P.flushGdd, span = leafy ? sp.elongSpanGdd : P.elongSpanGdd, budSet = leafy ? sp.budSetGdd : P.budSetGdd;
  const fallStart = leafy ? sp.colorDoy - 8 : P.shedStartDoy, fallEnd = leafy ? sp.fallDoy : P.shedEndDoy;
  if (s.gdd < flushGdd && doy < 180) return { name: 'Vegetační klid', hint: 'Pupeny čekají na teplo. Vhodná doba na výběr pupenů a hrubý řez.', season: doy < 60 ? 'winter' : 'spring' };
  if (s.gdd < Math.min(flushGdd + span + 40, budSet) && doy < 200 && year > 0)
    return leafy
      ? { name: 'Rašení a růst výhonů', hint: 'Nové výhony se prodlužují. Kliknutím na výhon ho zaštípnete; u většiny druhů pak ještě letos vyraší znovu.', season: 'spring' }
      : { name: 'Prodlužování svíček', hint: 'Teď se zaštipují svíčky: kliknutím na svíčku ji zkrátíte. Zkrácený výhon doroste jen ze zbylé části.', season: 'spring' };
  if (s.gdd < budSet && doy < 220) return { name: 'Vyzrávání letorostů', hint: leafy ? 'Výhony dřevnatí. Řez teď ještě vyvolá nový růst nebo pupeny na příští rok.' : 'Jehlice ještě dorůstají. Řez letorostu teď vyvolá nové pupeny ještě letos.', season: 'summer' };
  if (doy < fallStart) return { name: 'Zakládání pupenů', hint: 'V pupenech se rozhoduje o délce příštích výhonů. Řez po tomto termínu už letos pupeny nevytvoří.', season: 'summer' };
  if (doy < fallEnd) return leafy
    ? { name: 'Barvení a opad listí', hint: sp.marcescent > 0 ? 'Listí se barví; část suchých listů zůstane na stromě do jara.' : 'Listí se barví a opadává. Po opadu je dobře vidět stavba koruny.', season: 'autumn' }
    : { name: 'Opad starých jehlic', hint: 'Nejstarší ročník jehlic žloutne a opadává. Doba na výběr pupenů – vylomte přebytečné.', season: 'autumn' };
  return { name: 'Vegetační klid', hint: leafy ? 'Strom je bez listí a odpočívá. Vhodná doba na drátování a řez podle stavby koruny.' : 'Strom odpočívá. Vhodná doba na výběr pupenů a hrubý řez.', season: doy > 330 ? 'winter' : 'autumn' };
}

/** Sloupec období: v prvním roce vývoj semenáčku, pak roční cyklus stromu. Názvy odpovídají phase(). */
const PHASES_SEEDLING: [string, string, string][] = [
  ['Semínko v zemi', 'duben', 'Pusťte čas. Semínko vyklíčí, až se půda prohřeje.'],
  ['Klíčení', 'duben–květen', 'Žádné zásahy. Semenáček žije ze zásob a z děloh.'],
  ['Růst epikotylu', 'červen–srpen', 'Nechte růst. První rok se nestříhá ani nedrátuje.'],
  ['Zakládání pupenů', 'srpen–září', 'Zakládá se první terminální pupen. Žádné zásahy.'],
  ['Opad starých jehlic', 'září–říjen', 'První rok ještě nic neopadává. Bez zásahů.'],
  ['Vegetační klid', 'listopad–duben', 'Na jaře, až začnou nalévat pupeny, lze semenáček přesadit do většího květináče.'],
];
const PHASES_TREE: [string, string, string][] = [
  ['Vegetační klid', 'listopad–duben',
    'Hrubý řez a odstranění celých větví. Drátování – kůra teď drží na dřevě nejlépe. Výběr pupenů: u silných vrcholů nechte dva. Koncem období, když pupeny nalévají, je nejlepší čas na přesazení.'],
  ['Prodlužování svíček', 'duben–červen',
    'Zaštipování svíček: silné zkraťte o třetinu až polovinu, slabé nechte být. Nedrátujte a nepřesazujte – kůra se snadno odlupuje a strom je nejzranitelnější.'],
  ['Vyzrávání letorostů', 'červen–červenec',
    'Zkrácení vyzrálých letorostů tak, aby zůstaly jehlice – u řezu se ještě letos založí nové pupeny. Kontrolujte dráty, v době tloustnutí zarůstají nejrychleji.'],
  ['Zakládání pupenů', 'červenec–září',
    'Nechte strom růst, v pupenech se rozhoduje o příštím roce. Řez už letos nové pupeny nevytvoří. Koncem srpna je náhradní termín přesazení. Hlídejte zarůstající dráty.'],
  ['Opad starých jehlic', 'září–říjen',
    'Výběr pupenů – vylomte přebytečné. Začíná vhodná doba na drátování. Sundejte dráty, u kterých tvar už drží.'],
];
const PHASES_LEAFY: [string, string, string][] = [
  ['Vegetační klid', 'listopad–duben', 'Bez listí je vidět celá stavba: hrubý řez, výběr větví a drátování. Koncem období, když pupeny nalévají, je čas na přesazení.'],
  ['Rašení a růst výhonů', 'duben–červen', 'Zaštipování nových výhonů na 1–3 listy. Po zaštípnutí většina druhů vyraší podruhé – tak vzniká jemné větvení. Nedrátovat, kůra se snadno odlupuje.'],
  ['Vyzrávání letorostů', 'červen–červenec', 'Zkracování vyzrálých výhonů. Kontrolujte dráty – listnáče tloustnou rychle a tenká kůra se snadno poznamená.'],
  ['Zakládání pupenů', 'červenec–září', 'Nechte strom nabrat sílu. Řez teď už nový růst nevyvolá, jen pupeny na příští rok.'],
  ['Barvení a opad listí', 'září–listopad', 'Listí se barví a opadává. Začíná doba na drátování a úpravu stavby.'],
];
let phaseKey = '';
function refreshPhases(s: State, active: string) {
  const spc = speciesOf(s);
  const list = yearOf(s.day) === 0 ? PHASES_SEEDLING : spc.kind === 'leafy' ? PHASES_LEAFY : PHASES_TREE;
  const key = `${spc.id}:${list === PHASES_SEEDLING ? 's' : 't'}:${active}`;
  if (key === phaseKey) return;
  phaseKey = key;
  const ol = $('phaseList');
  ol.innerHTML = '';
  for (const [name, months, advice0] of list) {
    const advice = list === PHASES_SEEDLING ? advice0 : `${advice0} ${spc.name}: ${spc.care}`;
    const li = document.createElement('li');
    li.textContent = name;
    li.tabIndex = 0;
    const sp = document.createElement('span');
    sp.textContent = months;
    const tipEl = document.createElement('p');
    tipEl.textContent = advice;
    li.append(sp, tipEl);
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
    detail: `Táhněte větev tam, kam ji chcete ohnout. Bezpečný ohyb do ${deg(bendLimit(s, sh, arcZ()))}°, měděný drát ø ${String(wireGauge(radiusOf(sh))).replace('.', ',')} mm.`,
    danger: spring ? 'Strom je v růstu a kůra se snadno odlupuje – větve teď praskají dřív. Lepší je podzim až předjaří.' : '',
    action: null,
  };
}

/** Popíše, co zásah v daném místě udělá – ještě před kliknutím. */
function describe(p: Pick): Described | null {
  if (tool === 'wire') return describeWire(p);
  const s = tl.state;
  let sh = s.shoots.find((x) => x.id === p.shoot);
  if (!sh) return null;
  // Ctrl: celá větev až k nejbližšímu rozvětvení (nebo ke kmeni)
  if (p.type === 'shoot' && ctrlHeld && tool === 'cut') {
    const w = wholeBranch(s, sh.id);
    if (w) { sh = w; p = { type: 'shoot', shoot: w.id, t: 0 }; }
  }
  if (p.type === 'bud') {
    const pb = p.bud;
    const b = sh.buds.find((x) => x.id === pb);
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
  const sp = speciesOf(s);
  if (sp.kind === 'leafy') {
    const pctL = Math.round((1 - t) * 100);
    const leavesLeft = sh.kind !== 'hypocotyl' && sh.needleLive > 0.02 && Math.round(sh.needleCount * t) > 0;
    const budsLeft = Math.round((sh.dormant ?? (sh.bornYear === yearOf(s.day) ? sh.needleCount : 0)) * t) > 0;
    const kidsL = s.shoots.some((c) => c.parent === sh.id && c.attachT <= t && !c.dead) || sh.buds.some((b) => b.t <= t);
    const inLeaf = s.gdd >= sp.flushGdd && doyOf(s.day) < 230;
    let dangerL = '';
    if (!leavesLeft && !budsLeft && !kidsL) dangerL = 'Pod řezem nezůstane list ani živý pupen – tento úsek odumře.';
    else if (sp.dieback > 0 && yearOf(s.day) > sh.bornYear) dangerL = inLeaf ? `${sp.name}: řezaná větvička může zaschnout až k větvení.` : `${sp.name} se má řezat jen v listu. Teď řezaná větvička nejspíš zaschne až k větvení.`;
    else if (!leavesLeft && !kidsL && sp.epicormic < 0.5) dangerL = `${sp.name} obráží ze starého dřeva neochotně – nový výhon tu vyrůst nemusí.`;
    const again = sp.reflush > 0 && inLeaf && s.gdd < 1150 ? ' Za pár týdnů z nejvyšších pupenů vyraší znovu.' : ' Nové výhony vyrostou z nejvyšších zbylých pupenů příští jaro.';
    const young = sh.elong && sh.kind === 'shoot';
    return {
      title: young ? 'Zaštípnout letorost' : sub ? 'Zkrátit větev' : 'Zkrátit výhon',
      detail: `${young ? `Odstraní ${pctL} %. Zbytek doroste na ${cm(sh.targetLen * t)}.` : `Zůstane ${cm(sh.len * t)} z ${cm(sh.len)}.`}${plus}${leavesLeft || budsLeft ? again : ''}`,
      danger: dangerL, pick,
      action: { type: 'cut', shoot: sh.id, t, label: young ? `Zaštípnut letorost o ${pctL} %` : sub ? `Zkrácena větev o ${pctL} %` : `Zkrácen výhon o ${pctL} %` },
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
  $('sNeedlesLabel').textContent = speciesOf(s).foliageWord[0];
  $('spName').textContent = speciesOf(s).name;
  $('spLatin').textContent = `${speciesOf(s).latin} · ze semínka`;
  $('sGdd').textContent = `${Math.round(s.gdd)} d.d.`;
  slider.value = String(s.day);
  for (const b of $('toolSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  if (repotOpen) updateRepot();
  $('wireOpts').hidden = tool !== 'wire';
  $('cutOpts').hidden = tool !== 'cut';
  $<HTMLButtonElement>('cleanDead').disabled = !deadwood(s).size;
  $<HTMLButtonElement>('unwireAll').disabled = !s.shoots.some((x) => x.wire);
  {
    const nb = s.shoots.filter((x) => x.wire && x.scar).length;
    const bb = $<HTMLButtonElement>('unwireBiting');
    bb.disabled = nb === 0;
    bb.textContent = nb ? `Sundat zarůstající dráty (${nb})` : 'Sundat zarůstající dráty';
  }
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
let ctrlHeld = false; // Ctrl při řezu = celá větev k rozvětvení
let lastMouse: { ox: number; oy: number; cx: number; cy: number } | null = null;
// Shift + tažení nůžkami = řez podle linie
let cutLine: { x0: number; y0: number; cx0: number; cy0: number; cuts: { shoot: number; t: number }[] } | null = null;
const lineEl = $('cutLine');
function rehover() {
  if (!lastMouse || downAt || repotOpen || tool === 'wire') return;
  const p = view.pick(lastMouse.ox, lastMouse.oy, tool === 'bud');
  setHover(p ? describe(p) : null, lastMouse.cx, lastMouse.cy);
}
for (const ev of ['keydown', 'keyup'] as const) window.addEventListener(ev, (e) => {
  const c = e.ctrlKey || e.metaKey;
  if (c !== ctrlHeld) { ctrlHeld = c; rehover(); }
});

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
  else if (tool === 'cut' && e.shiftKey && e.button === 0 && !repotOpen) {
    cutLine = { x0: e.offsetX, y0: e.offsetY, cx0: e.clientX, cy0: e.clientY, cuts: [] };
    setHover(null);
  }
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
    if (cutLine) {
      cutLine.cuts = view.lineCuts(cutLine.x0, cutLine.y0, e.offsetX, e.offsetY);
      view.highlightCuts(cutLine.cuts);
      const lx = e.clientX - cutLine.cx0, ly = e.clientY - cutLine.cy0;
      lineEl.hidden = false;
      lineEl.style.left = `${cutLine.cx0}px`; lineEl.style.top = `${cutLine.cy0}px`;
      lineEl.style.width = `${Math.hypot(lx, ly)}px`; lineEl.style.transform = `rotate(${Math.atan2(ly, lx)}rad)`;
      tip.hidden = false; tip.className = '';
      tip.textContent = cutLine.cuts.length ? `Řez podle linie: ${cutLine.cuts.length} ${cutLine.cuts.length === 1 ? 'větev' : cutLine.cuts.length < 5 ? 'větve' : 'větví'}. Pusťte tlačítko pro řez.` : 'Řez podle linie: táhněte přes větve.';
      tip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 16)}px`; tip.style.top = `${Math.max(8, e.clientY - 44)}px`;
      return;
    }
    if (bend) {
      const sh = tl.state.shoots.find((x) => x.id === bend!.id)!;
      const tgt = view.bendTarget(bend.id, e.offsetX, e.offsetY);
      if (tgt) {
        const z = bend.z;
        const safe = bendLimit(tl.state, sh, z);
        bend.axis = tgt.axis;
        // kurzor určuje směr špičky; u oblouku je celkové stočení větší než úhel tětivy
        // strop tažení: kde riziko dosáhne 100 % (ve v8 se počítá od tvaru, který větev už drží)
        const held = tl.state.rules >= 8 && z > 0 ? heldArc(sh)?.angle ?? 0 : 0;
        bend.angle = Math.min(tgt.angle / (1 - z / 2), held + safe * (tl.state.rules >= 6 ? 2 : 1.5));
        const risk = breakRisk(tl.state, sh, bend.angle, z, bend.axis);
        const extra = bendStress(tl.state, sh, bend.axis, bend.angle, z);
        const more = Math.abs(extra - bend.angle) > 0.02 ? `, z toho nově ${deg(extra)}°` : '';
        const tmp = structuredClone(tl.state);
        bendShoot(tmp, bend.id, bend.axis, bend.angle, z);
        view.previewState(tmp, bend.id, risk > 0);
        const radius = z > 0 && bend.angle > 0.01 ? ` · poloměr ${cm((z * sh.len) / bend.angle)}` : '';
        tip.hidden = false;
        tip.className = risk > 0 ? 'danger' : '';
        tip.textContent = risk > 0
          ? `Ohyb ${deg(bend.angle)}°${more}${radius} · riziko prasknutí ${Math.round(risk * 100)} % (bezpečně do ${deg(safe)}°)`
          : `Ohyb ${deg(bend.angle)}°${more}${radius} · bezpečně do ${deg(safe)}°${more ? ' navíc' : ''}`;
        tip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 16)}px`;
        tip.style.top = `${Math.max(8, e.clientY - 44)}px`;
      }
      return;
    }
    if (downAt.button === 2 || e.shiftKey) view.pan(dx, dy); else view.orbit(dx, dy);
    if (hover) setHover(null);
    return;
  }
  ctrlHeld = e.ctrlKey || e.metaKey;
  lastMouse = { ox: e.offsetX, oy: e.offsetY, cx: e.clientX, cy: e.clientY };
  if (e.pointerType === 'mouse' && !repotOpen) {
    const pTree = view.pick(e.offsetX, e.offsetY, tool === 'bud');
    const onTool = pTree ? null : view.pickTool(e.offsetX, e.offsetY);
    if (onTool) {
      setHover(null);
      canvas.style.cursor = 'pointer';
      tip.hidden = false; tip.className = '';
      tip.textContent = onTool === 'cut' ? 'Nůžky – zaštipování, řez a vylamování pupenů' : 'Drát – tažením za větev ji ohnete';
      tip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 16)}px`; tip.style.top = `${e.clientY - 40}px`;
      return;
    }
    canvas.style.cursor = tool === 'wire' ? 'grab' : 'crosshair';
    const p = pTree;
    setHover(p ? describe(p) : null, e.clientX, e.clientY);
  }
});
const up = (e: PointerEvent) => {
  const wasTap = downAt && moved <= 5 && pointers.size === 1 && downAt.button === 0;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (!pointers.size) downAt = null;
  if (cutLine) {
    const cl = cutLine;
    cutLine = null; lineEl.hidden = true; tip.hidden = true; view.highlight(null);
    if (!wasTap && cl.cuts.length) {
      const nCut = cl.cuts.length;
      tl.act({ type: 'cutMany', cuts: cl.cuts, label: `Řez podle linie (${nCut} ${nCut === 1 ? 'větev' : nCut < 5 ? 'větve' : 'větví'})` });
      lastLogKey = ''; persist(); refresh();
    }
    return;
  }
  ctrlHeld = e.ctrlKey || e.metaKey;
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
  const p = view.pick(e.offsetX, e.offsetY, tool === 'bud');
  // strom má přednost; nářadí na stole se volí jen tam, kde pod kurzorem není výhon ani pupen
  const onTool = p ? null : view.pickTool(e.offsetX, e.offsetY);
  if (onTool) { setTool(onTool); return; }
  const d = p ? describe(p) : null;
  if (e.pointerType === 'mouse') { if (d) doAction(d); }
  else setHover(d, e.clientX, e.clientY, true);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); downAt = null; bend = null; cutLine = null; lineEl.hidden = true; });
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
function setTool(t: Tool) {
  tool = t;
  canvas.style.cursor = tool === 'wire' ? 'grab' : 'crosshair';
  view.setActiveTool(t === 'wire' ? 'wire' : 'cut');
  setHover(null);
  refresh();
}
for (const b of $('toolSeg').querySelectorAll('button')) {
  b.onclick = () => setTool(b.dataset.tool as Tool);
}
// najetí na tlačítko Drát nebo na řádek „Dráty“ zvýrazní všechny dráty na stromu
for (const el of [$('tool-wire'), $('sWires'), $('sWires').previousElementSibling as HTMLElement]) {
  el.addEventListener('pointerenter', () => view.showWires(true));
  el.addEventListener('pointerleave', () => view.showWires(false));
  el.addEventListener('focus', () => view.showWires(true));
  el.addEventListener('blur', () => view.showWires(false));
}
$('unwireBiting').onclick = () => {
  const cnt = tl.state.shoots.filter((x) => x.wire && x.scar).length;
  if (!cnt) return;
  tl.act({ type: 'unwireAll', only: 'biting', label: `Sundány zarůstající dráty (${cnt})` });
  lastLogKey = '';
  persist();
  refresh();
};
$('cleanDead').onclick = () => {
  const cnt = deadwood(tl.state).size;
  if (!cnt) return;
  tl.act({ type: 'cleanDead', label: `Odstraněny suché větve (${cnt})` });
  lastLogKey = '';
  persist();
  refresh();
};
$('unwireAll').onclick = () => {
  const cnt = tl.state.shoots.filter((x) => x.wire).length;
  if (!cnt) return;
  tl.act({ type: 'unwireAll', label: `Sundány všechny dráty (${cnt})` });
  lastLogKey = '';
  persist();
  refresh();
};
// --- sbírka: stromy uložené ve stavu, v jakém byly při přidání (semínko + deník zásahů do toho dne + portrét)
const SHELF = 'bonsai-collection-v1';
interface Kept { id: string; name: string; seed: number; actions: Action[]; day: number; thumb: string; height: number; savedAt: string; rules?: number; species?: string }
function loadShelf(): Kept[] {
  try { return JSON.parse(localStorage.getItem(SHELF) || '[]') as Kept[]; } catch { return []; }
}
function saveShelf(list: Kept[]): boolean {
  try { localStorage.setItem(SHELF, JSON.stringify(list)); return true; } catch { return false; }
}
function syncShelfBtn() { const n = loadShelf().length; $('shelfBtn').textContent = n ? `Moje sbírka (${n})` : 'Moje sbírka'; }

$('keep').onclick = () => {
  const s = tl.state;
  if (s.stage === 'seed') { flash('Semínko ještě nevyklíčilo – do sbírky přidejte až strom.'); return; }
  const list = loadShelf();
  const st = stats(s);
  list.push({
    id: `${Date.now()}`, name: `${speciesOf(s).name} · ${yearOf(s.day) + 1}. rok`, seed: tl.seed, rules: tl.rules, species: tl.species,
    actions: tl.actions.filter((a) => a.day <= s.day), day: s.day, thumb: view.capture(), height: st.height, savedAt: new Date().toISOString(),
  });
  if (!saveShelf(list)) { flash('Sbírku se nepodařilo uložit – úložiště prohlížeče je plné nebo nedostupné.'); return; }
  syncShelfBtn();
  flash('Strom je ve sbírce. Dál můžete pokračovat v pěstování.');
};

/** Vzorová sbírka: stromy vypěstované skriptem scripts/gardener.ts stejnými zásahy, jaké má hráč. */
interface Sample { id: string; name: string; style: string; about: string; seed: number; rules: number; day: number; height: number; trunk: number; actions: Action[] }
const SAMPLES = samplesJson as unknown as Sample[];
const THUMBS = sampleThumbs as Record<string, string>;

function renderSamples() {
  const bench = $('bench');
  bench.innerHTML = '';
  $('shelfTitle').textContent = 'Vzorová sbírka';
  $('shelfEmpty').hidden = true;
  $('shelfCount').textContent = 'stromy vypěstované ve hře, od semínka';
  for (const k of SAMPLES) {
    const el = document.createElement('div');
    el.className = 'kept';
    const img = document.createElement('img');
    img.src = THUMBS[k.id] || ''; img.alt = `${k.name} – ${k.style}`;
    const plank = document.createElement('div');
    plank.className = 'plank';
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('b');
    title.className = 'title'; title.textContent = `${k.name} · ${k.style}`;
    const about = document.createElement('p');
    about.textContent = k.about;
    const info = document.createElement('small');
    info.textContent = `${yearOf(k.day) + 1}. rok · ${cm(k.height)} · kmen ${k.trunk} mm · ${k.actions.length} zásahů`;
    const row = document.createElement('div');
    row.className = 'row';
    const open = document.createElement('button');
    open.textContent = 'Prohlédnout';
    let armed = 0;
    open.onclick = () => {
      if (Date.now() - armed > 10000) { armed = Date.now(); open.textContent = 'Nahradit rozpracovaný strom?'; return; }
      lastLogKey = '';
      start({ seed: k.seed, actions: k.actions, day: k.day, rules: k.rules });
      buildTrack(); persist();
      $('shelf').hidden = true;
      flash('Strom je načtený i s deníkem – posuvníkem času si projdete, jak vznikal.');
    };
    row.append(open);
    card.append(title, about, info, row);
    el.append(img, plank, card);
    bench.appendChild(el);
  }
}
$('samplesBtn').onclick = () => { playing = false; renderSamples(); $('shelf').hidden = false; refresh(); };

function renderShelf() {
  $('shelfTitle').textContent = 'Moje sbírka';
  const list = loadShelf();
  const bench = $('bench');
  bench.innerHTML = '';
  $('shelfEmpty').hidden = list.length > 0;
  $('shelfCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'strom' : list.length < 5 ? 'stromy' : 'stromů'}` : '';
  for (const k of list) {
    const el = document.createElement('div');
    el.className = 'kept';
    const img = document.createElement('img');
    img.src = k.thumb; img.alt = k.name;
    const plank = document.createElement('div');
    plank.className = 'plank';
    const card = document.createElement('div');
    card.className = 'card';
    const name = document.createElement('input');
    name.value = k.name; name.id = `kept-${k.id}`; name.setAttribute('aria-label', 'Název stromu');
    name.onchange = () => { const l = loadShelf(); const x = l.find((y) => y.id === k.id); if (x) { x.name = name.value.trim() || k.name; saveShelf(l); } };
    const info = document.createElement('small');
    const na = k.actions.length;
    info.textContent = `${fmtDate(k.day)} · ${cm(k.height)} · ${na} ${na === 1 ? 'zásah' : na >= 2 && na <= 4 ? 'zásahy' : 'zásahů'} · pravidla v${k.rules ?? 1}`;
    const row = document.createElement('div');
    row.className = 'row';
    const open = document.createElement('button');
    open.textContent = 'Pokračovat';
    let armedOpen = 0;
    open.onclick = () => {
      if (Date.now() - armedOpen > 10000) { armedOpen = Date.now(); open.textContent = 'Nahradit rozpracovaný strom?'; return; }
      lastLogKey = '';
      start({ seed: k.seed, actions: k.actions, day: k.day, rules: k.rules ?? 1, species: k.species ?? 'pine' });
      buildTrack(); persist();
      $('shelf').hidden = true;
    };
    const del = document.createElement('button');
    del.textContent = 'Odebrat';
    let armedDel = 0;
    del.onclick = () => {
      if (Date.now() - armedDel > 10000) { armedDel = Date.now(); del.textContent = 'Opravdu odebrat?'; return; }
      saveShelf(loadShelf().filter((y) => y.id !== k.id));
      syncShelfBtn(); renderShelf();
    };
    row.append(open, del);
    card.append(name, info, row);
    el.append(img, plank, card);
    bench.appendChild(el);
  }
}
$('shelfBtn').onclick = () => { playing = false; renderShelf(); $('shelf').hidden = false; refresh(); };
// přepínač verze pravidel: strom se přepočítá od semínka podle zvolených pravidel (zásahy zůstávají)
$<HTMLSelectElement>('rules').onchange = () => {
  const rules = Number($<HTMLSelectElement>('rules').value);
  lastLogKey = '';
  start({ seed: tl.seed, actions: tl.actions, day: tl.day, rules, species: tl.species });
  buildTrack(); persist();
  flash(`Strom přepočítán podle pravidel v${rules}. Zásahy, které v nich nenajdou svůj cíl, se neprovedou.`);
};
$('shelfClose').onclick = () => { $('shelf').hidden = true; };
syncShelfBtn();

// háček pro skripty (tvorba vzorové sbírky, testy v prohlížeči): načtení hry a portrét z daného úhlu
(window as any).bonsai = {
  load: (save: Save) => { lastLogKey = ''; start(save); buildTrack(); },
  pickCheck: (d?: number, f?: number, sh?: boolean) => view.pickCheck(d, f, sh),
  jointGap: () => ({ ...view.jointGap, attach: view.attachGap }),
  capture: (theta?: number, w?: number, h?: number) => { if (theta !== undefined) view.theta = theta; return view.capture(w, h); },
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
const rVals = () => ({ prune: Number(rIn('rPrune').value) / 100, yaw: Number(rIn('rYaw').value), side: Number(rIn('rSide').value), fwd: Number(rIn('rFwd').value), spread: Number(rIn('rSpread').value) / 100, offX: Number(rIn('rOffX').value) / 100, offZ: Number(rIn('rOffZ').value) / 100, mound: Number(rIn('rMound').value) / 100, glaze: $<HTMLSelectElement>('rGlaze').value });
for (const g of GLAZES) { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name; $('rGlaze').appendChild(o); }
$<HTMLSelectElement>('rGlaze').onchange = () => updateRepot();

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
  view.previewRoots(v.spread, [v.offX, v.offZ]);
  view.previewSoil({ mound: spec.type === 'ground' ? 0 : v.mound, glaze: v.glaze });
  $('rMoundV').textContent = v.mound ? `${Math.round(v.mound * 100)} %` : 'rovný';
  rIn('rMound').disabled = spec.type === 'ground';
  $<HTMLSelectElement>('rGlaze').disabled = spec.type !== 'bonsai';
  const offTxt = (x: number, neg: string, pos: string) => (x ? `${Math.round(Math.abs(x) * 100)} % ${x < 0 ? neg : pos}` : 'střed');
  $('rOffXV').textContent = offTxt(v.offX, 'vlevo', 'vpravo');
  $('rOffZV').textContent = offTxt(v.offZ, 'dozadu', 'dopředu');
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
  view.previewRoots(0, null);
  view.previewSoil(null);
  view.previewPot(null);
  refresh();
}
$('repotBtn').onclick = () => {
  if (repotOpen) { closeRepot(); return; }
  repotOpen = true; playing = false;
  rPot = tl.state.potId;
  rIn('rPrune').value = tl.state.pot === 'ground' || tl.state.stage === 'seed' ? '0' : '30';
  rIn('rYaw').value = '0'; rIn('rSide').value = '0'; rIn('rFwd').value = '0'; rIn('rSpread').value = '0';
  rIn('rOffX').value = String(Math.round((tl.state.potOffset?.[0] ?? 0) * 100)); rIn('rOffZ').value = String(Math.round((tl.state.potOffset?.[1] ?? 0) * 100));
  rIn('rMound').value = String(Math.round((tl.state.mound ?? 0) * 100));
  $<HTMLSelectElement>('rGlaze').value = tl.state.glaze ?? '';
  $('repot').hidden = false;
  view.front();
  setHover(null);
  refresh();
};
for (const id of ['rPrune', 'rYaw', 'rSide', 'rFwd', 'rSpread', 'rOffX', 'rOffZ', 'rMound']) rIn(id).oninput = updateRepot;
$('rCancel').onclick = closeRepot;
$('rOk').onclick = () => {
  const v = rVals();
  const spec = potById(rPot);
  const parts = [spec.name.toLowerCase()];
  if (v.prune) parts.push(`kořeny −${Math.round(v.prune * 100)} %`);
  if (v.yaw) parts.push(`otočení ${v.yaw}°`);
  if (v.side || v.fwd) parts.push(`náklon ${Math.round(Math.hypot(v.side, v.fwd))}°`);
  if (v.spread) parts.push('kořeny rozprostřeny');
  if (v.offX || v.offZ) parts.push('mimo střed nádoby');
  if (v.mound && spec.type !== 'ground') parts.push('substrát navršen');
  tl.act({ type: 'repot', pot: spec.type, potId: spec.id, prune: v.prune, yaw: v.yaw, tiltX: v.fwd, tiltZ: -v.side, spread: v.spread, offX: v.offX, offZ: v.offZ, mound: spec.type === 'ground' ? 0 : v.mound, glaze: v.glaze, label: `Přesazeno: ${parts.join(', ')}` });
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
// nové semínko: výběr druhu
function renderChooser() {
  const list = $('speciesList');
  list.innerHTML = '';
  for (const id of SPECIES_ORDER) {
    const sp = SPECIES[id];
    const card = document.createElement('div');
    card.className = 'spCard';
    const name = document.createElement('b'); name.textContent = sp.name;
    const latin = document.createElement('i'); latin.textContent = sp.latin;
    const about = document.createElement('p'); about.textContent = sp.about;
    const care = document.createElement('p'); care.className = 'care'; care.textContent = sp.care;
    const btn = document.createElement('button');
    btn.className = 'primary'; btn.textContent = 'Zasadit semínko'; btn.id = `plant-${id}`;
    let armed = 0;
    const fresh = tl.state.stage === 'seed' && !tl.actions.length;
    btn.onclick = () => {
      if (!fresh && Date.now() - armed > 10000) { armed = Date.now(); btn.textContent = 'Nahradit rozpracovaný strom?'; return; }
      lastLogKey = '';
      tl = new Timeline(Math.floor(Math.random() * 1e9), [], RULES_LATEST, id);
      $<HTMLSelectElement>('rules').value = String(tl.rules);
      view.recenter();
      buildTrack(); persist(); refresh();
      $('chooser').hidden = true;
    };
    card.append(name, latin, about, care, btn);
    list.appendChild(card);
  }
}
$('reset').onclick = () => { playing = false; renderChooser(); $('chooser').hidden = false; refresh(); };
$('chooserClose').onclick = () => { $('chooser').hidden = true; };
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
  if ($('shelf').hidden && $('chooser').hidden) view.frame(); // při prohlížení sbírky a výběru druhu scéna stojí
  requestAnimationFrame(loop);
}

const hot = (window as any).claude?.hot;
hot?.snapshot?.(() => ({ seed: tl.seed, actions: tl.actions, day: tl.day, rules: tl.rules, species: tl.species }));
start(loadSave());
buildTrack();
syncSpeed();
refresh();
requestAnimationFrame(loop);
