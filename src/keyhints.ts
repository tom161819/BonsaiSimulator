// Nápověda ovládání vlevo dole: klávesy a tlačítka myši podle zvoleného nástroje.
// Drží se stavu klávesnice a myši: stisknutá klávesa se v panelu „zamáčkne“, řádek, který odpovídá právě držené
// kombinaci (Ctrl / Shift), se zvýrazní a ostatní zeslábnou, stisknuté tlačítko myši na ikoně svítí.
// Čísla 1–4 přepínají nástroje.

export type HintTool = 'cut' | 'bud' | 'leaf' | 'wire';

type Part = 'ctrl' | 'shift' | '+' | 'L' | 'R' | 'W' | 'drag';
interface Row { parts: Part[]; mods: '' | 'ctrl' | 'shift'; label: string; sub: string }

const TOOLS: Record<HintTool, { name: string; key: string; rows: Row[] }> = {
  cut: {
    name: 'Nůžky', key: '1',
    rows: [
      { parts: ['L'], mods: '', label: 'Zkrátit větev', sub: 'v místě pod kurzorem' },
      { parts: ['ctrl', '+', 'L'], mods: 'ctrl', label: 'Celá větev', sub: 'až k rozvětvení' },
      { parts: ['shift', '+', 'L', 'drag'], mods: 'shift', label: 'Řez podle linie', sub: 'protne všechny větve' },
    ],
  },
  bud: {
    name: 'Pinzeta', key: '2',
    rows: [
      { parts: ['L'], mods: '', label: 'Vyštípnout pupen', sub: 'vytrhnout plevel, sloupnout mech' },
    ],
  },
  leaf: {
    name: 'Listy', key: '3',
    rows: [
      { parts: ['L'], mods: '', label: 'Odstranit listy', sub: 'z jednoho výhonu' },
      { parts: ['ctrl', '+', 'L'], mods: 'ctrl', label: 'Listy z celé větve', sub: 'až k rozvětvení' },
    ],
  },
  wire: {
    name: 'Drát', key: '4',
    rows: [
      { parts: ['L', 'drag'], mods: '', label: 'Ohnout větev', sub: 'držené místo jde za myší' },
      { parts: ['ctrl', '+', 'L'], mods: 'ctrl', label: 'Bod ohybu', sub: 'odsud se ohne další tah' },
      { parts: ['shift', '+', 'L', 'drag'], mods: 'shift', label: 'Od sebe / k sobě', sub: 'posun do hloubky' },
      { parts: ['L'], mods: '', label: 'Sundat drát', sub: 'klik na nadrátovaný výhon' },
    ],
  },
};
const ORDER: HintTool[] = ['cut', 'bud', 'leaf', 'wire'];

const NS = 'http://www.w3.org/2000/svg';
/** Myš s jedním zvýrazněným tlačítkem (L = levé, R = pravé, W = kolečko). */
function mouseIcon(btn: 'L' | 'R' | 'W'): string {
  return `<svg class="ico mouse m-${btn}" viewBox="0 0 16 22" width="15" height="20" aria-hidden="true" xmlns="${NS}">
    <path class="bL" d="M8 1.5V9H1.5V8a6.5 6.5 0 0 1 6.5-6.5z"/><path class="bR" d="M8 1.5V9h6.5V8A6.5 6.5 0 0 0 8 1.5z"/>
    <rect class="wh" x="6.5" y="3" width="3" height="4.8" rx="1.5"/>
    <rect class="body" x="1.5" y="1.5" width="13" height="19" rx="6.5"/><path class="div" d="M1.5 9h13M8 1.5V9"/></svg>`;
}
const DRAG = `<svg class="ico drag" viewBox="0 0 22 12" width="20" height="11" aria-hidden="true" xmlns="${NS}"><path d="M5 2 1.5 6 5 10M17 2l3.5 4L17 10M2 6h18"/></svg>`;
const WHEEL = `<svg class="ico wheel" viewBox="0 0 25 22" width="24" height="21" aria-hidden="true" xmlns="${NS}">
  <path class="bL" d="M8 1.5V9H1.5V8a6.5 6.5 0 0 1 6.5-6.5z"/><path class="bR" d="M8 1.5V9h6.5V8A6.5 6.5 0 0 0 8 1.5z"/>
  <rect class="wh" x="6.5" y="3" width="3" height="4.8" rx="1.5"/><rect class="body" x="1.5" y="1.5" width="13" height="19" rx="6.5"/><path class="div" d="M1.5 9h13M8 1.5V9"/>
  <path class="arr" d="M18.2 8 20.2 6 22.2 8M18.2 14 20.2 16 22.2 14"/></svg>`;

function partHtml(p: Part): string {
  switch (p) {
    case 'ctrl': return '<kbd data-k="ctrl">Ctrl</kbd>';
    case 'shift': return '<kbd data-k="shift">Shift</kbd>';
    case '+': return '<span class="kplus">+</span>';
    case 'L': case 'R': return mouseIcon(p);
    case 'W': return WHEEL;
    case 'drag': return DRAG;
  }
}

const ROOT_HTML = `
  <div class="khead">
    <span class="ktitle"><i class="kdot"></i><span class="kname-wrap"><b id="kName">Nůžky</b></span></span>
    <div class="ksw" id="kSw" role="group" aria-label="Přepnout nástroj"></div>
    <button id="kToggle" class="kbtn" aria-label="Skrýt nápovědu ovládání" aria-expanded="true" title="Skrýt / zobrazit nápovědu"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4.2 6 8l4-3.8"/></svg></button>
  </div>
  <div class="kbody"><div class="kinner">
    <div id="kRows" class="krows"></div>
    <div class="kview" aria-label="Pohled">
      <span class="kv" title="Táhnutí levým tlačítkem otáčí pohled">${mouseIcon('L')}${DRAG}<em>otáčet</em></span>
      <span class="kv" title="Táhnutí pravým tlačítkem posouvá pohled">${mouseIcon('R')}${DRAG}<em>posun</em></span>
      <span class="kv kwheel" title="Kolečko přibližuje a oddaluje">${WHEEL}<em>zoom</em></span>
      <span class="kv" title="Mezerník spouští a zastavuje čas"><kbd data-k="space">Mezerník</kbd><em>čas</em></span>
      <span class="kv" title="Vrátí poslední zásah"><kbd data-k="ctrl">Ctrl</kbd><span class="kplus">+</span><kbd data-k="z">Z</kbd><em>zpět</em></span>
    </div>
  </div></div>`;

const HIDDEN_KEY = 'bonsai-keys-hidden';

/** Sestaví panel do `root` a vrátí rozhraní pro hru. `onPick` se zavolá po stisku klávesy 1–4 nebo kliknutí na číslo. */
export function createKeyHints(root: HTMLElement, onPick: (t: HintTool) => boolean | void, layout: { avoid: HTMLElement; watch: HTMLElement[] }) {
  root.innerHTML = ROOT_HTML;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const rowsEl = q<HTMLDivElement>('#kRows'), nameEl = q<HTMLElement>('#kName'), sw = q<HTMLDivElement>('#kSw'), toggle = q<HTMLButtonElement>('#kToggle');
  let current: HintTool | null = null;
  let leafOk = true;

  // přepínač nástrojů: čísla jako klávesy
  for (const t of ORDER) {
    const b = document.createElement('button');
    b.className = 'ksw-b'; b.dataset.t = t; b.title = `${TOOLS[t].name} (${TOOLS[t].key})`;
    b.setAttribute('aria-label', `${TOOLS[t].name} – klávesa ${TOOLS[t].key}`);
    b.innerHTML = `<kbd>${TOOLS[t].key}</kbd>`;
    b.onclick = () => { onPick(t); b.blur(); };
    sw.appendChild(b);
  }

  const setHidden = (h: boolean, save = true) => {
    root.dataset.collapsed = h ? '1' : '0';
    toggle.setAttribute('aria-expanded', String(!h));
    toggle.setAttribute('aria-label', h ? 'Zobrazit nápovědu ovládání' : 'Skrýt nápovědu ovládání');
    if (save) { try { localStorage.setItem(HIDDEN_KEY, h ? '1' : '0'); } catch { /* bez uložení */ } }
  };
  let stored = false;
  try { stored = localStorage.getItem(HIDDEN_KEY) === '1'; } catch { /* bez uložení */ }
  setHidden(stored, false);
  toggle.onclick = () => { toggle.blur(); if (root.dataset.fit === '3') return; setHidden(root.dataset.collapsed !== '1'); fit(); };

  // ---- místo: panel stojí nad časovou osou a nesmí zasáhnout do levého sloupce nad sebou. Podle volného místa
  // se zmenšuje: 1 bez řady pohledu, 2 bez popisků, 3 jen hlavička (sbalený), 4 skrytý.
  function fit() {
    if (getComputedStyle(root).display === 'none') return; // skrytý pravidlem pro mobil / dotyk
    root.classList.add('nofx'); // měří se konečná výška, ne rozjetý přechod
    // offsetTop nezahrnuje transformace, takže vstupní animace panelu měření nezkreslí
    const limit = layout.avoid.offsetTop + layout.avoid.offsetHeight + 10;
    let lvl = 0;
    for (; lvl < 4; lvl++) {
      root.dataset.fit = String(lvl);
      if (root.offsetTop >= limit) break;
    }
    root.dataset.fit = String(lvl);
    toggle.disabled = lvl >= 3;
    void root.offsetWidth;
    requestAnimationFrame(() => root.classList.remove('nofx'));
  }
  let fitQueued = false;
  const scheduleFit = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };
  window.addEventListener('resize', scheduleFit);
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(scheduleFit); for (const el of layout.watch) ro.observe(el); }
  scheduleFit();

  // ---- klávesy a myš
  let ctrl = false, shift = false;
  const extra = { space: false, z: false }; // klávesy, které se jen zamáčknou (bez vlivu na řádky)
  const applyMods = () => {
    const held = ctrl ? (shift ? 'both' : 'ctrl') : shift ? 'shift' : '';
    for (const k of root.querySelectorAll<HTMLElement>('kbd[data-k]')) {
      const id = k.dataset.k as string;
      k.classList.toggle('down', id === 'ctrl' ? ctrl : id === 'shift' ? shift : id === 'space' ? extra.space : id === 'z' ? extra.z : false);
    }
    root.classList.toggle('mod', held !== '');
    for (const r of rowsEl.querySelectorAll<HTMLElement>('.krow')) r.classList.toggle('on', held !== '' && r.dataset.mods === held);
  };
  const setMods = (c: boolean, s: boolean) => { if (c !== ctrl || s !== shift) { ctrl = c; shift = s; applyMods(); } };
  const setButtons = (b: number) => { root.dataset.btn = `${b & 1 ? 'L' : ''}${b & 2 ? 'R' : ''}${b & 4 ? 'W' : ''}`; };
  const setExtra = (e: KeyboardEvent, down: boolean) => {
    const sp = e.code === 'Space' ? down : extra.space, z = e.key.toLowerCase() === 'z' ? down : extra.z;
    if (sp !== extra.space || z !== extra.z) { extra.space = sp; extra.z = z; applyMods(); }
  };
  window.addEventListener('keydown', (e) => {
    setMods(e.ctrlKey || e.metaKey, e.shiftKey); setExtra(e, true);
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const t = ORDER.find((x) => TOOLS[x].key === e.key);
    if (t) onPick(t);
  });
  window.addEventListener('keyup', (e) => { setMods(e.ctrlKey || e.metaKey, e.shiftKey); setExtra(e, false); });
  window.addEventListener('blur', () => { setMods(false, false); extra.space = false; extra.z = false; applyMods(); setButtons(0); });
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { setButtons(e.buttons); setMods(e.ctrlKey || e.metaKey, e.shiftKey); } }, true);
  window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') setButtons(e.buttons); }, true);
  window.addEventListener('pointercancel', () => setButtons(0), true);
  let wheelTimer = 0;
  window.addEventListener('wheel', () => {
    root.classList.add('wheeling');
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => root.classList.remove('wheeling'), 320);
  }, { passive: true });

  const render = (t: HintTool) => {
    const info = TOOLS[t];
    root.dataset.tool = t;
    // název nástroje se přelije
    nameEl.classList.remove('swap'); void nameEl.offsetWidth;
    nameEl.textContent = info.name; nameEl.classList.add('swap');
    rowsEl.innerHTML = info.rows.map((r, i) => `<div class="krow" style="--i:${i}" data-mods="${r.mods}">
      <span class="kkeys">${r.parts.map(partHtml).join('')}</span>
      <span class="ktext"><b>${r.label}</b><small>${r.sub}</small></span></div>`).join('');
    applyMods();
  };

  return {
    /** Zvolený nástroj; leafAvailable = nástroj Listy je dostupný (listnáč a pravidla v10). */
    show(t: HintTool, leafAvailable: boolean) {
      if (t !== current) { current = t; render(t); fit(); }
      leafOk = leafAvailable;
      for (const b of sw.querySelectorAll<HTMLButtonElement>('.ksw-b')) {
        const on = b.dataset.t === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('off', b.dataset.t === 'leaf' && !leafOk);
      }
    },
  };
}
