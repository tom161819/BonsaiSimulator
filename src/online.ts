// Online část hry: účty hráčů, sbírka v cloudu, výstava a hodnocení.
// Backend je Supabase (adresa a veřejný klíč se vloží při sestavení, viz scripts/build.mjs); data chrání pravidla RLS
// v supabase/migrations. Paměťový backend (?online=demo) slouží k vyzkoušení rozhraní bez serveru.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Action } from './sim/types';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export interface OnlineUser { id: string; username: string; email: string }
export interface CloudTree {
  id: string; name: string; species: string; seed: number; rules: number; day: number;
  actions: Action[]; thumb: string | null; height: number; savedAt: string; exhibitedAt: string | null;
}
export type NewTree = Omit<CloudTree, 'id' | 'savedAt' | 'exhibitedAt'>;
export interface Exhibit {
  id: string; owner: string; username: string; name: string; species: string; height: number; day: number; rules: number;
  exhibitedAt: string; votes: number; stars: number; avg: number | null;
}
export interface TopTree { id: string; owner: string; username: string; name: string; species: string; votes: number; stars: number; avg: number }
export interface TopUser { id: string; username: string; stars: number; votes: number; avg: number | null; exhibited: number }
export interface UserStats { username: string; stars: number; votes: number; avg: number | null; exhibited: number; trees: number | null }

export interface Backend {
  readonly kind: 'supabase' | 'demo';
  user(): OnlineUser | null;
  /** změna přihlášení; recovery = hráč přišel z odkazu na obnovu hesla */
  onAuth(fn: (u: OnlineUser | null, recovery: boolean) => void): void;
  signUp(email: string, password: string, username: string): Promise<{ confirm: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** přezdívka (společná pro hru i aplikaci) */
  setUsername(name: string): Promise<void>;
  myTrees(): Promise<CloudTree[]>;
  saveTree(t: NewTree): Promise<CloudTree>;
  renameTree(id: string, name: string): Promise<void>;
  deleteTree(id: string): Promise<void>;
  setExhibited(id: string, on: boolean): Promise<void>;
  exhibition(): Promise<Exhibit[]>;
  /** náhled a záznam vystaveného (nebo vlastního) stromu */
  treeData(id: string): Promise<Pick<CloudTree, 'thumb' | 'actions' | 'seed' | 'rules' | 'day' | 'species'> | null>;
  myRatings(): Promise<Record<string, number>>;
  rate(id: string, stars: number): Promise<void>;
  topTrees(n: number): Promise<TopTree[]>;
  topUsers(n: number): Promise<TopUser[]>;
  stats(uid: string): Promise<UserStats | null>;
}

/** Chyby serveru v češtině (zbytek se ukáže tak, jak přišel). */
export function czError(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/invalid login credentials/i.test(m)) return 'Špatný e-mail nebo heslo.';
  if (/already registered|already been registered|user_already_exists/i.test(m)) return 'Na tento e-mail už účet existuje – přihlaste se.';
  if (/email not confirmed/i.test(m)) return 'E-mail ještě není potvrzený – klikněte na odkaz, který vám přišel.';
  if (/password.*(at least|6 char|short)/i.test(m)) return 'Heslo musí mít aspoň 6 znaků.';
  if (/rate limit|too many/i.test(m)) return 'Příliš mnoho pokusů – zkuste to za chvíli.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return 'Neplatná e-mailová adresa.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'Server je nedostupný – zkontrolujte připojení.';
  if (/row-level security|violates row-level|permission denied/i.test(m)) return 'K tomu nemáte oprávnění.';
  if (/profiles_username_key|duplicate key/i.test(m)) return 'Tato přezdívka už je obsazená.';
  if (/check constraint|violates check/i.test(m)) return 'Údaje neprošly kontrolou (přezdívka 3–24 znaků, název do 60 znaků, menší náhled).';
  return m || 'Neznámá chyba.';
}

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

// ------------------------------------------------------------------ Supabase

function supabaseBackend(url: string, key: string): Backend {
  // výchozí úložiště přihlášení (sb-<projekt>-auth-token): aplikace Bonsai deník na stejné adrese
  // (tom161819.github.io) ho sdílí, takže přihlášení v jedné platí i v druhé
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let me: OnlineUser | null = null;
  const subs: ((u: OnlineUser | null, recovery: boolean) => void)[] = [];
  const emit = (recovery = false) => { for (const f of subs) f(me, recovery); };
  const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
  const loadMe = async (uid: string, email: string) => {
    const { data } = await sb.from('profiles').select('username').eq('id', uid).maybeSingle();
    let username = data?.username as string | undefined;
    if (!username) {
      // účet bez profilu (vznikl dřív, než databáze profily znala): založí se podle e-mailu
      const base = (email.split('@')[0] || 'hráč').replace(/[<>"\\]/g, '').slice(0, 18).padEnd(3, '_');
      for (let k = 0; k < 5 && !username; k++) {
        const name = k ? `${base}-${Math.floor(100 + Math.random() * 900)}` : base;
        const { error } = await sb.from('profiles').insert({ id: uid, username: name });
        if (!error) username = name;
      }
    }
    me = { id: uid, email, username: username ?? email.split('@')[0] };
  };
  sb.auth.onAuthStateChange((ev, session) => {
    // načtení profilu mimo obsluhu události (doporučení supabase-js: v ní nevolat další dotazy)
    setTimeout(async () => {
      if (session?.user) { if (!me || me.id !== session.user.id) await loadMe(session.user.id, session.user.email ?? ''); }
      else me = null;
      emit(ev === 'PASSWORD_RECOVERY');
    }, 0);
  });
  const treeRow = (r: Record<string, unknown>): CloudTree => ({
    id: String(r.id), name: String(r.name), species: String(r.species), seed: Number(r.seed), rules: Number(r.rules), day: Number(r.day),
    actions: (r.actions as Action[]) ?? [], thumb: (r.thumb as string | null) ?? null, height: Number(r.height), savedAt: String(r.saved_at), exhibitedAt: (r.exhibited_at as string | null) ?? null,
  });
  const here = () => location.origin + location.pathname;
  return {
    kind: 'supabase',
    user: () => me,
    onAuth: (fn) => { subs.push(fn); },
    async signUp(email, password, username) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: here() } });
      fail(error);
      return { confirm: !data.session };
    },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); fail(error); },
    async signOut() { const { error } = await sb.auth.signOut(); fail(error); },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() }); fail(error); },
    async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); fail(error); },
    async setUsername(name) {
      if (!me) throw new Error('Nejste přihlášeni.');
      const { error } = await sb.from('profiles').update({ username: name }).eq('id', me.id);
      fail(error);
      me = { ...me, username: name };
      emit();
    },
    async myTrees() {
      if (!me) return [];
      const { data, error } = await sb.from('game_trees').select('*').eq('owner', me.id).order('saved_at', { ascending: false });
      fail(error);
      return (data ?? []).map(treeRow);
    },
    async saveTree(t) {
      const { data, error } = await sb.from('game_trees').insert({ name: t.name, species: t.species, seed: t.seed, rules: t.rules, day: t.day, actions: t.actions, thumb: t.thumb, height: t.height }).select('*').single();
      fail(error);
      return treeRow(data as Record<string, unknown>);
    },
    async renameTree(id, name) { const { error } = await sb.from('game_trees').update({ name }).eq('id', id); fail(error); },
    async deleteTree(id) { const { error } = await sb.from('game_trees').delete().eq('id', id); fail(error); },
    async setExhibited(id, on) { const { error } = await sb.from('game_trees').update({ exhibited_at: on ? new Date().toISOString() : null }).eq('id', id); fail(error); },
    async exhibition() {
      const { data, error } = await sb.rpc('game_exhibition');
      fail(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id), owner: String(r.owner), username: String(r.username), name: String(r.name), species: String(r.species), height: Number(r.height),
        day: Number(r.day), rules: Number(r.rules), exhibitedAt: String(r.exhibited_at), votes: Number(r.votes), stars: Number(r.stars), avg: num(r.avg_stars),
      }));
    },
    async treeData(id) {
      const { data, error } = await sb.from('game_trees').select('thumb, actions, seed, rules, day, species').eq('id', id).maybeSingle();
      fail(error);
      return data ? { thumb: data.thumb as string | null, actions: data.actions as Action[], seed: Number(data.seed), rules: Number(data.rules), day: Number(data.day), species: String(data.species) } : null;
    },
    async myRatings() {
      if (!me) return {};
      const { data, error } = await sb.from('game_ratings').select('tree_id, stars').eq('rater', me.id);
      fail(error);
      return Object.fromEntries((data ?? []).map((r) => [String(r.tree_id), Number(r.stars)]));
    },
    async rate(id, stars) {
      if (!me) throw new Error('Nejste přihlášeni.');
      const { error } = await sb.from('game_ratings').upsert({ tree_id: id, rater: me.id, stars }, { onConflict: 'tree_id,rater' });
      fail(error);
    },
    async topTrees(n) {
      const { data, error } = await sb.rpc('game_top_trees', { lim: n });
      fail(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), owner: String(r.owner), username: String(r.username), name: String(r.name), species: String(r.species), votes: Number(r.votes), stars: Number(r.stars), avg: Number(r.avg_stars) }));
    },
    async topUsers(n) {
      const { data, error } = await sb.rpc('game_top_users', { lim: n });
      fail(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), username: String(r.username), stars: Number(r.stars), votes: Number(r.votes), avg: num(r.avg_stars), exhibited: Number(r.exhibited) }));
    },
    async stats(uid) {
      const { data, error } = await sb.rpc('game_user_stats', { uid });
      fail(error);
      const r = ((data ?? []) as Record<string, unknown>[])[0];
      return r ? { username: String(r.username), stars: Number(r.stars), votes: Number(r.votes), avg: num(r.avg_stars), exhibited: Number(r.exhibited), trees: num(r.trees) } : null;
    },
  };
}

// ------------------------------------------------------------------ ukázka bez serveru (?online=demo)

/** Paměťový backend se stejnými pravidly jako databáze (hodnotit jen cizí vystavené stromy, 1–10 hvězdiček).
 *  Data žijí jen do zavření stránky. Slouží k vyzkoušení rozhraní a k automatickým zkouškám. */
function demoBackend(): Backend {
  interface Row extends CloudTree { owner: string }
  const users = new Map<string, { id: string; email: string; username: string; password: string }>();
  const trees: Row[] = [];
  const ratings = new Map<string, number>(); // `${tree}|${rater}`
  let me: OnlineUser | null = null;
  const subs: ((u: OnlineUser | null, recovery: boolean) => void)[] = [];
  const emit = () => { for (const f of subs) f(me, false); };
  const wait = () => new Promise((r) => setTimeout(r, 60));
  const need = () => { if (!me) throw new Error('Nejste přihlášeni.'); return me; };
  const votesOf = (id: string) => [...ratings].filter(([k]) => k.startsWith(id + '|')).map(([, v]) => v);
  const avg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null);
  let n = 0;
  const id = () => `demo-${++n}`;
  const api: Backend & { _seed(list: (NewTree & { username: string })[], votes: number[][]): void } = {
    kind: 'demo',
    user: () => me,
    onAuth: (fn) => { subs.push(fn); },
    async signUp(email, password, username) {
      await wait();
      if ([...users.values()].some((u) => u.email === email)) throw new Error('User already registered');
      if (password.length < 6) throw new Error('Password should be at least 6 characters');
      let name = username.trim().slice(0, 20) || 'hráč', k = 0;
      while ([...users.values()].some((u) => u.username.toLowerCase() === name.toLowerCase())) name = `${username.trim().slice(0, 20)}-${++k}`;
      const u = { id: id(), email, username: name, password };
      users.set(u.id, u);
      me = { id: u.id, email, username: name };
      emit();
      return { confirm: false };
    },
    async signIn(email, password) {
      await wait();
      const u = [...users.values()].find((x) => x.email === email && x.password === password);
      if (!u) throw new Error('Invalid login credentials');
      me = { id: u.id, email, username: u.username };
      emit();
    },
    async signOut() { me = null; emit(); },
    async resetPassword() { await wait(); },
    async updatePassword(p) { const u = users.get(need().id)!; u.password = p; },
    async setUsername(name) {
      const u = users.get(need().id)!;
      if ([...users.values()].some((x) => x !== u && x.username.toLowerCase() === name.toLowerCase())) throw new Error('duplicate key value violates unique constraint "profiles_username_key"');
      u.username = name; me = { ...me!, username: name }; emit();
    },
    async myTrees() { await wait(); const u = me; return u ? trees.filter((t) => t.owner === u.id).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) : []; },
    async saveTree(t) { await wait(); const u = need(); const row: Row = { ...t, id: id(), owner: u.id, savedAt: new Date().toISOString(), exhibitedAt: null }; trees.push(row); return row; },
    async renameTree(tid, name) { const t = trees.find((x) => x.id === tid && x.owner === need().id); if (t) t.name = name; },
    async deleteTree(tid) { const u = need(); const i = trees.findIndex((x) => x.id === tid && x.owner === u.id); if (i >= 0) trees.splice(i, 1); },
    async setExhibited(tid, on) { const t = trees.find((x) => x.id === tid && x.owner === need().id); if (t) t.exhibitedAt = on ? new Date().toISOString() : null; },
    async exhibition() {
      await wait();
      return trees.filter((t) => t.exhibitedAt).sort((a, b) => b.exhibitedAt!.localeCompare(a.exhibitedAt!)).map((t) => {
        const v = votesOf(t.id);
        return { id: t.id, owner: t.owner, username: users.get(t.owner)?.username ?? '?', name: t.name, species: t.species, height: t.height, day: t.day, rules: t.rules, exhibitedAt: t.exhibitedAt!, votes: v.length, stars: v.reduce((a, b) => a + b, 0), avg: avg(v) };
      });
    },
    async treeData(tid) { const t = trees.find((x) => x.id === tid && (x.exhibitedAt || x.owner === me?.id)); return t ? { thumb: t.thumb, actions: t.actions, seed: t.seed, rules: t.rules, day: t.day, species: t.species } : null; },
    async myRatings() { const u = me; if (!u) return {}; return Object.fromEntries([...ratings].filter(([k]) => k.endsWith('|' + u.id)).map(([k, v]) => [k.split('|')[0], v])); },
    async rate(tid, stars) {
      await wait();
      const u = need(), t = trees.find((x) => x.id === tid);
      if (!t || !t.exhibitedAt || t.owner === u.id || !(stars >= 1 && stars <= 10)) throw new Error('new row violates row-level security policy');
      ratings.set(`${tid}|${u.id}`, Math.round(stars));
    },
    async topTrees(k) {
      const ex = await api.exhibition();
      return ex.filter((e) => e.votes > 0).sort((a, b) => b.avg! - a.avg! || b.votes - a.votes).slice(0, k).map((e) => ({ id: e.id, owner: e.owner, username: e.username, name: e.name, species: e.species, votes: e.votes, stars: e.stars, avg: e.avg! }));
    },
    async topUsers(k) {
      const out: TopUser[] = [];
      for (const u of users.values()) {
        const v = trees.filter((t) => t.owner === u.id).flatMap((t) => votesOf(t.id));
        if (v.length) out.push({ id: u.id, username: u.username, stars: v.reduce((a, b) => a + b, 0), votes: v.length, avg: avg(v), exhibited: trees.filter((t) => t.owner === u.id && t.exhibitedAt).length });
      }
      return out.sort((a, b) => b.stars - a.stars || (b.avg ?? 0) - (a.avg ?? 0)).slice(0, k);
    },
    async stats(uid) {
      const u = users.get(uid);
      if (!u) return null;
      const v = trees.filter((t) => t.owner === uid).flatMap((t) => votesOf(t.id));
      return { username: u.username, stars: v.reduce((a, b) => a + b, 0), votes: v.length, avg: avg(v), exhibited: trees.filter((t) => t.owner === uid && t.exhibitedAt).length, trees: uid === me?.id ? trees.filter((t) => t.owner === uid).length : null };
    },
    /** ukázkoví vystavovatelé (jen v režimu ?online=demo) */
    _seed(list, votes) {
      list.forEach((t, i) => {
        let u = [...users.values()].find((x) => x.username === t.username);
        if (!u) { u = { id: id(), email: `${t.username}@demo`, username: t.username, password: 'demo-heslo' }; users.set(u.id, u); }
        const row: Row = { ...t, id: id(), owner: u.id, savedAt: new Date(Date.now() - i * 3600e3).toISOString(), exhibitedAt: new Date(Date.now() - i * 3600e3).toISOString() };
        trees.push(row);
        (votes[i] ?? []).forEach((st, j) => ratings.set(`${row.id}|voter-${j}`, st));
      });
    },
  };
  return api;
}

export const SUPABASE_URL = typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : '';
const SUPABASE_KEY = typeof __SUPABASE_ANON_KEY__ === 'string' ? __SUPABASE_ANON_KEY__ : '';

/** Backend podle sestavení: Supabase, ukázka (?online=demo), nebo null = hra jen v prohlížeči. */
export function createBackend(): (Backend & { _seed?: (list: (NewTree & { username: string })[], votes: number[][]) => void }) | null {
  let demo = false;
  try { demo = new URLSearchParams(location.search).get('online') === 'demo'; } catch { /* bez adresy */ }
  if (demo) return demoBackend();
  if (SUPABASE_URL && SUPABASE_KEY) {
    try { return supabaseBackend(SUPABASE_URL, SUPABASE_KEY); } catch { return null; }
  }
  return null;
}

/** Náhled do databáze: WebP je několikrát menší než PNG (prohlížeč bez WebP vrátí PNG). */
export function shrinkThumb(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const w = c.toDataURL('image/webp', 0.86);
      resolve(w.startsWith('data:image/webp') && w.length < dataUrl.length ? w : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
