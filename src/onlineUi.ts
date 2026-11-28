// Rozhraní online části: panel hráče (ve sbírce a na výstavě), přihlášení / registrace a obrazovka výstavy
// s hodnocením 1–10 hvězdiček a žebříčky.
import { czError, type Backend, type Exhibit, type OnlineUser } from './online';
import type { Action } from './sim/types';

export interface OnlineDeps {
  flash(msg: string): void;
  /** načte strom do simulátoru (po potvrzení) a zavře překryvné obrazovky */
  loadTree(t: { seed: number; actions: Action[]; day: number; rules: number; species: string }, note: string): void;
  speciesName(id: string): string;
  fmtDate(day: number): string;
  cm(x: number): string;
  /** stromy uložené jen v prohlížeči (k nahrání do účtu) */
  localCount(): number;
  uploadLocal(): Promise<number>;
  /** přenos sbírky kódem: export ze stránky bez serveru (např. claude.ai), import do účtu na webu */
  openTransfer(mode: 'export' | 'import'): void;
  /** po přihlášení / odhlášení: sbírka se překreslí z účtu nebo z prohlížeče */
  userChanged(u: OnlineUser | null): void;
  pause(): void;
  /** stojan pod stromem podle velikosti misky v náhledu (sdílené se sbírkou) */
  fitStand(box: HTMLElement): void;
  /** je náhled v aktuální verzi pohledu? jinak ho jde přefotit ze záznamu stromu */
  thumbCurrent(url: string | null): boolean;
  renderThumb(rec: { seed: number; actions: Action[]; day: number; rules: number; species: string }): string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const fmt = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '–' : x.toFixed(d).replace('.', ','));
const STAR = '★';

export function initOnline(initial: Backend | null, deps: OnlineDeps) {
  let backend = initial;
  // ------------------------------------------------------------ panel hráče
  let statsCache: { uid: string; at: number; v: Awaited<ReturnType<Backend['stats']>> } | null = null;
  async function renderUserCards() {
    const cards = [...document.querySelectorAll<HTMLElement>('.userCard')];
    const u = backend?.user() ?? null;
    for (const c of cards) {
      c.innerHTML = '';
      const head = el('div', 'ucHead');
      const ava = el('span', 'ucAvatar', u ? u.username.slice(0, 1).toUpperCase() : '?');
      ava.setAttribute('aria-hidden', 'true');
      const who = el('div', 'ucWho');
      who.append(el('b', 'ucName', u ? u.username : 'Nepřihlášený hráč'), el('small', '', u ? u.email : backend ? 'Stromy jsou jen v tomto prohlížeči' : 'Hra běží bez serveru'));
      head.append(ava, who);
      if (u && backend) {
        // přezdívka je společná pro hru i aplikaci Bonsai deník; jde změnit
        const edit = el('button', 'ucEdit', 'Změnit');
        edit.title = 'Změnit přezdívku';
        edit.onclick = () => {
          const form = el('form', 'ucRename');
          const inp = el('input'); inp.value = u.username; inp.maxLength = 24; inp.minLength = 3; inp.setAttribute('aria-label', 'Nová přezdívka');
          const ok = el('button', 'primary', 'Uložit'), no = el('button', '', 'Zpět');
          ok.type = 'submit'; no.type = 'button';
          const note = el('small', 'hint');
          no.onclick = () => renderUserCards();
          form.onsubmit = async (e) => {
            e.preventDefault();
            const v = inp.value.trim();
            if (v.length < 3) { note.textContent = 'Přezdívka musí mít aspoň 3 znaky.'; return; }
            ok.disabled = true;
            try { await backend!.setUsername(v); deps.flash('Přezdívka je změněná.'); }
            catch (err) { note.textContent = czError(err); note.classList.add('bad'); ok.disabled = false; }
          };
          form.append(inp, ok, no, note);
          head.replaceWith(form);
          inp.focus(); inp.select();
        };
        head.appendChild(edit);
      }
      c.appendChild(head);
      if (!backend) {
        c.appendChild(el('p', 'ucText', 'Účty a výstava běží ve verzi hry na webu (bonsaier.com). Tady se stromy ukládají jen v tomto prohlížeči – kódem je přenesete do svého účtu.'));
        if (deps.localCount()) { const x = el('button', 'primary', 'Přenést sbírku na web'); x.onclick = () => deps.openTransfer('export'); c.appendChild(x); }
        continue;
      }
      if (!u) {
        c.appendChild(el('p', 'ucText', 'Pro spolehlivé uložení stromů se přihlaste (nebo zaregistrujte). Pak se budete moct zúčastnit i výstav – vybraný strom ze sbírky pošlete na výstavu a ostatní hráči ho ohodnotí.'));
        const row = el('div', 'row');
        const a = el('button', 'primary', 'Přihlásit'), b = el('button', '', 'Registrovat');
        a.onclick = () => openAuth('in'); b.onclick = () => openAuth('up');
        row.append(a, b);
        // výstavu si může prohlédnout každý; hodnotit jen přihlášený
        if ($('expo').hidden) { const ex = el('button', '', 'Výstava'); ex.title = 'Prohlédnout vystavené stromy a žebříčky'; ex.onclick = () => openExpo(); row.append(ex); }
        c.appendChild(row);
        continue;
      }
      // souhrn: hvězdičky celkem, průměr, počet vystavených stromů
      const grid = el('dl', 'ucStats');
      const add = (k: string, v: string, title = '') => { const dt = el('dt', '', k), dd = el('dd', '', v); if (title) dd.title = title; grid.append(dt, dd); };
      const st = statsCache && statsCache.uid === u.id ? statsCache.v : null;
      add('Hvězdičky celkem', st ? `${st.stars} ${STAR}` : '…');
      add('Průměr', st ? (st.avg === null ? '–' : `${fmt(st.avg, 2)} ${STAR}`) : '…', st ? `z ${st.votes} hodnocení` : '');
      add('Vystavené stromy', st ? String(st.exhibited) : '…');
      if (st && st.trees !== null) add('Stromy v účtu', String(st.trees));
      c.appendChild(grid);
      const nLocal = deps.localCount();
      if (nLocal) {
        const up = el('button', 'ucUpload', `Nahrát ${nLocal} ${nLocal === 1 ? 'strom' : nLocal < 5 ? 'stromy' : 'stromů'} z prohlížeče do účtu`);
        up.onclick = async () => {
          up.disabled = true; up.textContent = 'Nahrávám…';
          try { const n = await deps.uploadLocal(); deps.flash(`Do účtu nahráno ${n} ${n === 1 ? 'strom' : n < 5 ? 'stromy' : 'stromů'}. V prohlížeči zůstávají i nadále.`); refreshStats(); deps.userChanged(u); }
          catch (e) { deps.flash(`Nahrání se nepovedlo: ${czError(e)}`); up.disabled = false; }
        };
        c.appendChild(up);
      }
      const imp = el('button', 'ucUpload', 'Importovat sbírku z kódu');
      imp.title = 'Vložit kód sbírky vytvořený tlačítkem „Přenést sbírku na web“ (např. ve verzi hry na claude.ai)';
      imp.onclick = () => deps.openTransfer('import');
      c.appendChild(imp);
      const row = el('div', 'row');
      const ex = el('button', '', 'Výstava'), out = el('button', '', 'Odhlásit');
      ex.onclick = () => openExpo();
      out.onclick = async () => { try { await backend!.signOut(); } catch (e) { deps.flash(czError(e)); } };
      if ($('expo').hidden) row.append(ex);
      row.append(out);
      c.appendChild(row);
    }
  }
  async function refreshStats() {
    const u = backend?.user();
    if (!backend || !u) return;
    try { statsCache = { uid: u.id, at: Date.now(), v: await backend.stats(u.id) }; } catch { /* zůstanou tečky */ }
    renderUserCards();
  }

  // ------------------------------------------------------------ přihlášení a registrace
  type Mode = 'in' | 'up' | 'forgot' | 'newpass';
  let mode: Mode = 'in';
  const dlg = $('authDlg'), msg = $('authMsg');
  function setMode(m: Mode) {
    mode = m;
    const t: Record<Mode, [string, string]> = { in: ['Přihlášení', 'Přihlásit'], up: ['Registrace', 'Vytvořit účet'], forgot: ['Zapomenuté heslo', 'Poslat odkaz'], newpass: ['Nové heslo', 'Uložit heslo'] };
    $('authTitle').textContent = t[m][0];
    $('authOk').textContent = t[m][1];
    $('authTabs').hidden = m === 'forgot' || m === 'newpass';
    for (const b of $('authTabs').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
    $('authNameRow').hidden = m !== 'up';
    $('authMailRow').hidden = m === 'newpass';
    $('authPassRow').hidden = m === 'forgot';
    $('authForgot').hidden = m !== 'in';
    $<HTMLInputElement>('authName').required = m === 'up';
    $<HTMLInputElement>('authMail').required = m !== 'newpass';
    $<HTMLInputElement>('authPass').required = m !== 'forgot';
    $<HTMLInputElement>('authPass').autocomplete = m === 'in' ? 'current-password' : 'new-password';
    msg.textContent = m === 'up' ? 'Přezdívku uvidí ostatní hráči u vašich stromů na výstavě a v žebříčku.' : m === 'forgot' ? 'Pošleme vám odkaz, kterým si nastavíte nové heslo.' : '';
    msg.className = 'hint';
  }
  function openAuth(m: Mode) {
    if (!backend) return;
    deps.pause();
    setMode(m);
    dlg.hidden = false;
    (m === 'newpass' ? $('authPass') : m === 'up' ? $('authName') : $('authMail')).focus();
  }
  const closeAuth = () => { dlg.hidden = true; };
  for (const b of $('authTabs').querySelectorAll<HTMLButtonElement>('button')) b.onclick = () => setMode(b.dataset.mode as Mode);
  $('authForgot').onclick = () => setMode('forgot');
  $('authCancel').onclick = closeAuth;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeAuth(); });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAuth(); } });
  $<HTMLFormElement>('authForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!backend) return;
    const mail = $<HTMLInputElement>('authMail').value.trim(), pass = $<HTMLInputElement>('authPass').value, name = $<HTMLInputElement>('authName').value.trim();
    const ok = $<HTMLButtonElement>('authOk');
    ok.disabled = true; msg.className = 'hint'; msg.textContent = 'Čekám na server…';
    try {
      if (mode === 'in') { await backend.signIn(mail, pass); closeAuth(); }
      else if (mode === 'up') {
        if (name.length < 3) throw new Error('Přezdívka musí mít aspoň 3 znaky.');
        const r = await backend.signUp(mail, pass, name);
        if (r.confirm) { setMode('in'); msg.textContent = `Účet je vytvořený. Na ${mail} přišel odkaz pro jeho potvrzení – po kliknutí na něj se tady přihlaste.`; }
        else closeAuth();
      } else if (mode === 'forgot') { await backend.resetPassword(mail); msg.textContent = `Pokud účet existuje, na ${mail} přišel odkaz pro nové heslo.`; }
      else { await backend.updatePassword(pass); closeAuth(); deps.flash('Heslo je změněné.'); }
    } catch (err) { msg.className = 'hint bad'; msg.textContent = czError(err); }
    ok.disabled = false;
  };

  backend?.onAuth((u, recovery) => {
    statsCache = null;
    renderUserCards();
    if (u) refreshStats();
    if (recovery) openAuth('newpass');
    deps.userChanged(u);
    if (!$('expo').hidden) loadExpo(curId);
  });

  // ------------------------------------------------------------ výstava
  let list: Exhibit[] = [];
  let mine: Record<string, number> = {};
  let idx = 0, curId: string | null = null;
  const thumbs = new Map<string, string | null>();
  let armed = 0;

  function openExpo(focusId: string | null = null) {
    deps.pause();
    $('shelf').hidden = true;
    $('expo').hidden = false;
    renderUserCards();
    loadExpo(focusId);
  }
  function closeExpo() { $('expo').hidden = true; }
  async function loadExpo(focusId: string | null) {
    if (!backend) { $('expoEmpty').hidden = false; $('expoEmpty').textContent = 'Výstava běží jen ve verzi hry se serverem.'; $('expoStage').hidden = true; return; }
    $('expoCount').textContent = 'načítám…';
    try {
      const [ex, my, tt, tu] = await Promise.all([backend.exhibition(), backend.myRatings(), backend.topTrees(10), backend.topUsers(10)]);
      list = ex; mine = my;
      renderBoards(tt, tu);
    } catch (e) {
      $('expoCount').textContent = '';
      $('expoEmpty').hidden = false; $('expoStage').hidden = true;
      $('expoEmpty').textContent = `Výstavu se nepodařilo načíst: ${czError(e)}`;
      return;
    }
    $('expoCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'strom' : list.length < 5 ? 'stromy' : 'stromů'}` : '';
    const at = focusId ? list.findIndex((x) => x.id === focusId) : -1;
    idx = at >= 0 ? at : Math.min(idx, Math.max(0, list.length - 1));
    show();
  }
  function renderBoards(tt: Awaited<ReturnType<Backend['topTrees']>>, tu: Awaited<ReturnType<Backend['topUsers']>>) {
    const ot = $('topTrees'), ou = $('topUsers');
    ot.innerHTML = ''; ou.innerHTML = '';
    if (!tt.length) ot.appendChild(el('li', 'empty', 'Zatím žádný strom nemá hodnocení.'));
    for (const t of tt) {
      const li = el('li'), b = el('button', 'boardRow');
      b.append(el('span', 'bName', t.name), el('span', 'bWho', t.username), el('span', 'bScore', `${fmt(t.avg, 1)} ${STAR}`));
      b.title = `${t.votes} hodnocení, celkem ${t.stars} ${STAR}`;
      b.onclick = () => { const i = list.findIndex((x) => x.id === t.id); if (i >= 0) { idx = i; show(); } };
      li.appendChild(b); ot.appendChild(li);
    }
    if (!tu.length) ou.appendChild(el('li', 'empty', 'Zatím nikdo nezískal hvězdičku.'));
    for (const u of tu) {
      const li = el('li'), row = el('div', 'boardRow');
      row.append(el('span', 'bName', u.username), el('span', 'bWho', `${u.exhibited} ${u.exhibited === 1 ? 'strom' : u.exhibited >= 2 && u.exhibited <= 4 ? 'stromy' : 'stromů'} · Ø ${fmt(u.avg, 1)}`), el('span', 'bScore', `${u.stars} ${STAR}`));
      li.appendChild(row); ou.appendChild(li);
    }
  }
  async function show() {
    const empty = !list.length;
    $('expoEmpty').hidden = !empty; $('expoStage').hidden = empty;
    if (empty) { $('expoEmpty').textContent = 'Na výstavě zatím nic není. Strom vystavíte ve své sbírce tlačítkem „Vystavit“.'; return; }
    idx = (idx + list.length) % list.length;
    const x = list[idx];
    curId = x.id;
    armed = 0;
    $('expoOpen').textContent = 'Prohlédnout ve hře';
    $('expoPos').textContent = `${idx + 1} / ${list.length}`;
    $('expoName').textContent = x.name;
    $('expoMeta').textContent = `${deps.speciesName(x.species)} · ${deps.cm(x.height)} · ${deps.fmtDate(x.day)} · vystavuje ${x.username}`;
    $('expoScore').textContent = x.votes ? `${fmt(x.avg, 1)} ${STAR} průměr z ${x.votes} ${'hodnocení'} · celkem ${x.stars} ${STAR}` : 'Zatím bez hodnocení';
    for (const b of document.querySelectorAll<HTMLButtonElement>('.expoNav')) b.disabled = list.length < 2;
    renderStars(x);
    const img = $<HTMLImageElement>('expoImg');
    img.alt = `${x.name} – ${deps.speciesName(x.species)}`;
    if (!thumbs.has(x.id)) {
      img.removeAttribute('src'); img.classList.add('loading');
      try {
        const d = await backend!.treeData(x.id);
        thumbs.set(x.id, d?.thumb ?? null);
        // starší náhled (jiný pohled než stojan): přefotí se ze záznamu stromu, jen pro zobrazení
        if (d && !deps.thumbCurrent(d.thumb)) setTimeout(() => {
          try {
            const url = deps.renderThumb(d);
            thumbs.set(x.id, url);
            if (curId === x.id && !$('expo').hidden) { img.src = url; deps.fitStand(img.parentElement!); }
          } catch { /* zůstane starý náhled */ }
        }, 30);
      } catch { thumbs.set(x.id, null); }
    }
    if (curId !== x.id) return; // mezitím přešel jinam
    const src = thumbs.get(x.id);
    img.classList.remove('loading');
    if (src) img.src = src; else img.removeAttribute('src');
    if (src) deps.fitStand(img.parentElement!);
    // předem načíst sousední náhled
    const nx = list[(idx + 1) % list.length];
    if (nx && !thumbs.has(nx.id)) backend!.treeData(nx.id).then((d) => thumbs.set(nx.id, d?.thumb ?? null)).catch(() => undefined);
  }
  function renderStars(x: Exhibit) {
    const box = $('expoStars'), note = $('expoNote');
    box.innerHTML = '';
    const u = backend?.user() ?? null, own = !!u && u.id === x.owner, can = !!u && !own;
    const my = mine[x.id] ?? 0;
    for (let k = 1; k <= 10; k++) {
      const b = el('button', 'star' + (k <= my ? ' on' : ''), STAR);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === my));
      b.setAttribute('aria-label', `${k} ${k === 1 ? 'hvězdička' : k < 5 ? 'hvězdičky' : 'hvězdiček'}`);
      b.disabled = !can;
      b.onpointerenter = () => { if (can) box.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('hover', i < k)); };
      b.onclick = () => rate(x, k);
      box.appendChild(b);
    }
    box.onpointerleave = () => box.querySelectorAll('.star').forEach((s) => s.classList.remove('hover'));
    note.innerHTML = '';
    if (!u) {
      note.append('Hodnotit mohou přihlášení hráči. ');
      const a = el('button', 'link', 'Přihlásit se'); a.onclick = () => openAuth('in'); note.appendChild(a);
    } else if (own) note.textContent = 'Tohle je váš strom – svůj hodnotit nemůžete.';
    else note.textContent = my ? `Vaše hodnocení: ${my} z 10. Kliknutím ho změníte. Klávesy 1–9 a 0 (= 10), šipky ← → přepínají stromy.` : 'Ohodnoťte strom 1–10 hvězdičkami (nebo klávesami 1–9 a 0 = 10). Šipkou → přejdete na další.';
  }
  async function rate(x: Exhibit, k: number) {
    if (!backend) return;
    const before = mine[x.id];
    mine[x.id] = k; renderStars(x);
    try {
      await backend.rate(x.id, k);
      const keep = x.id;
      const [ex, tt, tu] = await Promise.all([backend.exhibition(), backend.topTrees(10), backend.topUsers(10)]);
      list = ex; renderBoards(tt, tu);
      const i = list.findIndex((y) => y.id === keep);
      if (i >= 0) idx = i;
      show();
    } catch (e) {
      if (before) mine[x.id] = before; else delete mine[x.id];
      renderStars(x);
      deps.flash(`Hodnocení se neuložilo: ${czError(e)}`);
    }
  }
  const step = (d: number) => { if (list.length > 1) { idx += d; show(); } };
  for (const b of document.querySelectorAll<HTMLButtonElement>('.expoNav')) b.onclick = () => step(b.classList.contains('next') ? 1 : -1);
  $('expoClose').onclick = closeExpo;
  $('expoOpen').onclick = async () => {
    const x = list[idx];
    if (!x || !backend) return;
    if (Date.now() - armed > 10000) { armed = Date.now(); $('expoOpen').textContent = 'Nahradit rozpracovaný strom?'; return; }
    try {
      const d = await backend.treeData(x.id);
      if (!d) throw new Error('Strom už na výstavě není.');
      closeExpo();
      deps.loadTree(d, `Strom „${x.name}“ hráče ${x.username} je načtený i s deníkem – posuvníkem času si projdete, jak vznikal.`);
    } catch (e) { deps.flash(czError(e)); }
  };
  // klávesy na výstavě: šipky přepínají stromy, číslice hodnotí (nepřepínají nástroje)
  window.addEventListener('keydown', (e) => {
    if ($('expo').hidden || !dlg.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { step(e.key === 'ArrowRight' ? 1 : -1); }
    else if (/^[0-9]$/.test(e.key)) { const x = list[idx], u = backend?.user(); if (x && u && u.id !== x.owner) rate(x, e.key === '0' ? 10 : Number(e.key)); }
    else if (e.key === 'Escape') closeExpo();
    else if (e.code === 'Space') { /* čas se na výstavě nespouští */ }
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  renderUserCards();
  /** server není dosažitelný: hra pokračuje bez online části */
  function disable() { backend = null; closeExpo(); dlg.hidden = true; renderUserCards(); }
  return { renderUserCards, refreshStats, openAuth, openExpo, closeExpo, disable };
}
