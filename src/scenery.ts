// Nastavení scény: pozadí, deska stolu a zobrazení. Fotky jsou z Poly Haven (CC0), viz scripts/assets/scenery.py.

export interface Backdrop { id: string; name: string; photo?: boolean; center?: number; thumb: string }
/** center = vodorovné místo panoramatu (0..1), které je z výchozího pohledu za stromem. */
export const BACKDROPS: Backdrop[] = [
  { id: 'default', name: 'Rozostřená zahrada', thumb: 'linear-gradient(#a8c4dc 0 34%, #dde7df 40%, #8fa77c 52%, #5b6f52)' },
  { id: 'garden', name: 'Čínská zahrada', photo: true, center: 0.56, thumb: 'tex/bg_garden_t.jpg' },
  { id: 'nursery', name: 'Školka pod stínovkou', photo: true, center: 0.6, thumb: 'tex/bg_nursery_t.jpg' },
  { id: 'glasshouse', name: 'Zahrada pod sklem', photo: true, center: 0.5, thumb: 'tex/bg_glasshouse_t.jpg' },
  { id: 'patio', name: 'Kryté patio', photo: true, center: 0.47, thumb: 'tex/bg_patio_t.jpg' },
  { id: 'studio', name: 'Světlé studio', thumb: 'linear-gradient(#f4f4f0, #d9ddd6)' },
  { id: 'studioDark', name: 'Tmavé studio', thumb: 'linear-gradient(#3a403c, #121614)' },
];

export interface TableSkin { id: string; name: string; tile: number; rot?: boolean; thumb: string }
/** tile = kolik cm desky pokryje jedna dlaždice textury; rot = léta dřeva jsou v obrázku svisle (otočí se podél stolu). */
export const TABLES: TableSkin[] = [
  { id: 'default', name: 'Prkenný stůl', tile: 60, thumb: 'repeating-linear-gradient(#8a6440 0 9px, #7a5634 9px 10px, #93704a 10px 19px, #6b4a2c 19px 20px)' },
  { id: 'teak', name: 'Teak', tile: 90, thumb: 'tex/table_teak_t.jpg' },
  { id: 'mahogany', name: 'Mahagon', tile: 90, thumb: 'tex/table_mahogany_t.jpg' },
  { id: 'walnut', name: 'Ořech', tile: 90, rot: true, thumb: 'tex/table_walnut_t.jpg' },
  { id: 'bamboo', name: 'Bambus', tile: 80, rot: true, thumb: 'tex/table_bamboo_t.jpg' },
  { id: 'oldwood', name: 'Staré dřevo', tile: 110, thumb: 'tex/table_oldwood_t.jpg' },
  { id: 'tatami', name: 'Tatami', tile: 190, thumb: 'tex/table_tatami_t.jpg' },
  { id: 'granite', name: 'Žula', tile: 120, thumb: 'tex/table_granite_t.jpg' },
];

export type Quality = 'low' | 'mid' | 'high';
export interface Settings { quality: Quality; shadows: boolean; keys: boolean; props: boolean; backdrop: string; table: string; uiScale: number }
export const DEFAULT_SETTINGS: Settings = { quality: 'mid', shadows: true, keys: true, props: true, backdrop: 'default', table: 'default', uiScale: 100 };

const KEY = 'bonsai-settings';
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      if (!BACKDROPS.some((b) => b.id === s.backdrop)) s.backdrop = 'default';
      if (!TABLES.some((t) => t.id === s.table)) s.table = 'default';
      if (!['low', 'mid', 'high'].includes(s.quality)) s.quality = 'mid';
      s.uiScale = Math.min(150, Math.max(80, Math.round(Number(s.uiScale) / 5) * 5 || 100));
      return s;
    }
  } catch { /* úložiště nemusí být dostupné */ }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* nevadí */ }
}
