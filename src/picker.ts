// Rozbalovací výběr s náhledem: najetí myší (nebo šipkami) na položku ji hned ukáže na stromě,
// kliknutí (Enter) ji zvolí, odjetí mimo seznam / Esc vrátí zvolenou. Nativní <select> najetí na položky nehlásí.

export interface PickItem {
  value: string;
  label: string;
  sub?: string; // druhý řádek drobně (rozměry, počet tvarů…)
  swatch?: string; // barva čtverečku (CSS)
  group?: string; // nadpis skupiny – vypíše se, když se změní
}

export interface Picker {
  set(items: PickItem[], value: string): void;
  setValue(value: string): void;
  readonly value: string;
  disabled: boolean;
  close(): void;
}

let openOne: { close(): void } | null = null;

/** Zvětšení rozhraní (Nastavení → Velikost rozhraní). Zvětšený prvek s pevnou polohou má souřadnice v nezvětšených px. */
export const uiZoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--uis')) || 1;

export function createPicker(host: HTMLElement, label: string, onPreview: (v: string | null) => void, onPick: (v: string) => void): Picker {
  let items: PickItem[] = [];
  let value = '';
  let active = -1;
  let list: HTMLDivElement | null = null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pickBtn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', label);
  host.appendChild(btn);

  const swatchEl = (c: string) => { const s = document.createElement('span'); s.className = 'swatch'; s.style.background = c; s.setAttribute('aria-hidden', 'true'); return s; };
  const paintBtn = () => {
    btn.innerHTML = '';
    const it = items.find((x) => x.value === value);
    if (it?.swatch) btn.appendChild(swatchEl(it.swatch));
    const t = document.createElement('span'); t.className = 'pickLabel'; t.textContent = it ? it.label : '—';
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 12 12'); chev.setAttribute('width', '12'); chev.setAttribute('height', '12'); chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML = '<path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
    btn.append(t, chev);
  };

  const opts = () => (list ? [...list.querySelectorAll<HTMLElement>('[role="option"]')] : []);
  const setActive = (i: number, preview = true, scroll = true) => {
    const os = opts();
    if (!os.length) return;
    active = Math.max(0, Math.min(os.length - 1, i));
    os.forEach((o, k) => o.classList.toggle('active', k === active));
    list!.setAttribute('aria-activedescendant', os[active].id);
    if (scroll) os[active].scrollIntoView({ block: 'nearest' });
    if (preview) onPreview(items[active].value);
  };
  const close = (revert = true) => {
    if (!list) return;
    list.remove(); list = null; active = -1;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', closeNow);
    window.removeEventListener('scroll', onScroll, true);
    if (openOne === api) openOne = null;
    if (revert) onPreview(null);
  };
  const closeNow = () => close();
  // rolování stránky nebo panelu pod seznamem: seznam by visel na starém místě
  const onScroll = (e: Event) => { if (list && e.target instanceof Node && !list.contains(e.target)) close(); };
  const outside = (e: PointerEvent) => { if (list && !list.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); };
  const pick = (i: number) => {
    const it = items[i];
    close(false);
    onPreview(null);
    if (it && it.value !== value) { value = it.value; paintBtn(); onPick(value); }
    btn.focus();
  };
  const open = () => {
    if (list || api.disabled) return;
    openOne?.close();
    openOne = api;
    list = document.createElement('div');
    list.className = 'pickList';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label);
    list.tabIndex = -1;
    let group: string | undefined;
    const uid = Math.random().toString(36).slice(2, 7);
    items.forEach((it, i) => {
      if (it.group && it.group !== group) {
        group = it.group;
        const g = document.createElement('div'); g.className = 'pickGroup'; g.textContent = it.group; g.setAttribute('aria-hidden', 'true');
        list!.appendChild(g);
      }
      const o = document.createElement('div');
      o.className = 'pickOpt' + (it.value === value ? ' chosen' : '');
      o.setAttribute('role', 'option'); o.id = `po-${uid}-${i}`;
      o.setAttribute('aria-selected', String(it.value === value));
      if (it.swatch) o.appendChild(swatchEl(it.swatch));
      const txt = document.createElement('span'); txt.className = 'pickTxt';
      const b = document.createElement('span'); b.textContent = it.label; txt.appendChild(b);
      if (it.sub) { const sm = document.createElement('small'); sm.textContent = it.sub; txt.appendChild(sm); }
      o.appendChild(txt);
      o.addEventListener('pointerenter', () => setActive(i, true, false));
      o.addEventListener('click', () => pick(i));
      list!.appendChild(o);
    });
    // odjetí ze seznamu: náhled se vrátí na zvolenou položku
    list.addEventListener('pointerleave', () => { opts().forEach((o) => o.classList.remove('active')); active = -1; onPreview(null); });
    list.addEventListener('keydown', key);
    document.body.appendChild(list);
    // seznam se otevře pod tlačítkem, a když se tam nevejde, nad ním; dlouhý se roluje kolečkem
    const z = uiZoom(), r = btn.getBoundingClientRect(), vh = window.innerHeight, gap = 4;
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < 220 * z && above > below;
    const maxH = Math.max(120 * z, Math.min(420 * z, up ? above : below));
    list.style.minWidth = `${Math.round(r.width / z)}px`;
    list.style.maxHeight = `${Math.round(maxH / z)}px`;
    list.style.left = `${Math.round(Math.min(r.left, window.innerWidth - Math.max(r.width, list.offsetWidth * z) - 8) / z)}px`;
    if (up) list.style.bottom = `${Math.round((vh - r.top + gap) / z)}px`; else list.style.top = `${Math.round((r.bottom + gap) / z)}px`;
    btn.setAttribute('aria-expanded', 'true');
    const cur = items.findIndex((x) => x.value === value);
    if (cur >= 0) { const os = opts(); os[cur].scrollIntoView({ block: 'center' }); }
    list.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', closeNow);
    window.addEventListener('scroll', onScroll, true);
  };
  function key(e: KeyboardEvent) {
    const n = items.length;
    if (e.key === 'ArrowDown') setActive(active < 0 ? items.findIndex((x) => x.value === value) + 1 : active + 1);
    else if (e.key === 'ArrowUp') setActive(active < 0 ? Math.max(0, items.findIndex((x) => x.value === value) - 1) : active - 1);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') { if (active >= 0) pick(active); else close(); }
    else if (e.key === 'Escape') { close(); btn.focus(); }
    else if (e.key === 'Tab') { close(); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
  }
  btn.addEventListener('click', () => (list ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); setActive(items.findIndex((x) => x.value === value) + (e.key === 'ArrowDown' ? 1 : -1)); }
  });

  const api = {
    set(next: PickItem[], v: string) { items = next; value = v; paintBtn(); if (list) { close(false); } },
    setValue(v: string) { value = v; paintBtn(); },
    get value() { return value; },
    get disabled() { return btn.disabled; },
    set disabled(d: boolean) { btn.disabled = d; if (d) close(); },
    close: () => close(),
  };
  return api;
}
