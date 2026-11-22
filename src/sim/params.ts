// Druhové parametry: borovice lesní (Pinus sylvestris L.).
// Každý další druh = další takový soubor. Zdroje a zdůvodnění hodnot: docs/KONCEPT.md.

import type { PotType } from './types';

export const P = {
  // --- klima a fenologie (teplotní suma nad +5 °C od 1. ledna) ---
  baseTemp: 5,
  germGdd: 60, // klíčení semene po výsevu
  flushGdd: 60, // začátek prodlužování svíček (~ 2. polovina dubna)
  elongSpanGdd: 490, // délka prodlužování; konec ~ 550 d.d. (~ 2. polovina června)
  needleStartGdd: 110, // jehlice začínají růst téměř současně s výhonem
  needleSpanGdd: 900, // a rostou do přelomu července/srpna
  budSetGdd: 800, // zakládání pupenů na příští rok (červenec)
  budGrowGdd: 600, // jak dlouho pupen dorůstá
  cambiumStartGdd: 150,
  cambiumEndGdd: 1300,
  shedStartDoy: 250, // opad nejstarších jehlic: září–říjen
  shedEndDoy: 300,
  needleRetention: 3, // jehlice vydrží 3 vegetační sezóny (stř. Evropa 2–4)

  // --- semenáček ---
  hypocotylLen: 2.4,
  hypocotylDays: 14,
  epicotylDelayDays: 18,
  epicotylLen: 2.2,
  epicotylGddSpan: 1000,
  seedlingBudSetDoy: 235,
  juvenileEfficiency: 2.5, // primární jehlice a dělohy jsou na jednotku plochy výkonnější

  // --- alokace růstu (Borchert–Honda / Palubicki 2009) ---
  growthPerFoliage: 2.0, // cm nového výhonu na jednotku osluněného olistění
  lambdaLateral: 0.22, // apikální kontrola: váha bočních os proti hlavní
  sinkExp: 0.95, // síla jímky ~ Q^exp; <1 tlumí převahu mohutných spodních větví nad terminálem
  weightPinch: 0.7, // pupeny po zaštípnutí jsou slabší jímka než terminál
  weightBack: 0.3, // zpětné pupeny na starším dřevě
  whorlRatioTrunk: 0.55, // délka bočního výhonu přeslenu / délka terminálu
  whorlRatioBranch: 0.6,
  minShoot: 0.4, // slabší pupen se nezaloží (cm)
  maxLeader: 60,
  maxLateral: 35,
  maxBackShoot: 5,
  ageEff: [1, 0.8, 0.5], // účinnost jehlic podle stáří ročníku

  // --- světlo (voxelová stínová mřížka) ---
  voxelMin: 2.5,
  voxelPerHeight: 22,
  shadeK: 0.3,
  shadeDecay: 0.7,
  shadeLayers: 4,
  lightDeath: 0.08, // pod touto hodnotou výhon nezakládá pupeny a shazuje jehlice

  // --- jehlice ---
  bareBase: 0.1, // spodních 10 % přírůstku je bez jehlic
  needleLenMin: 2.0, // cm; slabé výhony
  needleLenGain: 3.5, // cm; přídavek u silných výhonů (celkem až ~5,5 cm)
  needleLenScale: 8, // cm délky výhonu, při které je získáno ~63 % přídavku

  // --- tloušťkový růst (Presslerův zákon: přírůst plochy letokruhu ~ olistění nad místem) ---
  areaPerFoliage: 0.0035, // cm² za rok na jednotku olistění
  shootRadius0: 0.07, // cm
  shootRadiusPerLen: 0.006,

  // --- kořeny a přesazování ---
  rootPerLiter: 40, // kolik kořenů (v jednotkách olistění, které uživí) se vejde do litru substrátu
  rootGrowth: 0.35, // přírůst kořenů za rok na jednotku olistění (zpomaluje, jak se nádoba plní)
  rootBoundStart: 0.75, // od tohoto zaplnění nádoby růst slábne
  rootBoundFull: 1.6, // při tomto zaplnění je růst na minimu
  rootBoundMin: 0.3,
  rootMaxFill: 1.8,
  repotBaseStress: 0.1, // stres ze samotného přesazení
  repotPruneStress: 1.0, // stres na jednotku odstraněných kořenů
  stressGrowthLoss: 0.7, // o kolik stres 1,0 sníží růstový rozpočet
  stressDecay: 0.75, // podíl stresu, který odezní za vegetační sezónu

  // --- drátování ---
  wireMinSeasons: 1.0, // tenká větvička drží tvar po jedné sezóně tloustnutí
  wireSeasonsPerCm: 1.0, // + sezóna na každý cm poloměru
  wireBite: 1.45, // poměr průřezu, při kterém drát zarůstá (poloměr +20 %)
  bendK: 28, // bezpečný ohyb ve stupních ≈ bendK / (poloměr cm + 0,25)
  bendMin: 8,
  bendMax: 80,
  bendArcMax: 150,
  bendStrain: 0.05, // oblouk: největší poměr poloměru větve k poloměru ohybu
  bendSpringFactor: 0.6, // v době jarního růstu se kůra snadno odlupuje – menší bezpečný ohyb

  // --- prověšování větví vahou ---
  sagK: 0.02, // stupně za rok ≈ sagK · olistění větve · vodorovnost / průřez
  sagMaxPerYear: 2.5,
  sagFloor: 0.02, // větev se neprověsí pod tento sklon (složka y směru)

  // --- šištice ---
  coneMinAge: 8, // strom začíná plodit kolem 8.–15. roku
  maleChance: 0.3, // slabší boční letorosty nesou samčí šištice
  femaleChance: 0.07, // silné letorosty nesou šišky

  maxShoots: 7000,
};

/** Typ stanoviště: growth = jak dobře substrát strom živí (mělká miska hůř než hluboký kontejner),
 *  needle = vliv na délku jehlic. */
export const POT: Record<PotType, { name: string; growth: number; needle: number }> = {
  ground: { name: 'Volná půda', growth: 1.0, needle: 1.0 },
  training: { name: 'Pěstební nádoba', growth: 0.9, needle: 0.9 },
  bonsai: { name: 'Bonsajová miska', growth: 0.75, needle: 0.72 },
};
/** Účinnost stanoviště v původních pravidlech (v1): miska strom živila výrazně hůř. */
export const POT_GROWTH_V1: Record<PotType, number> = { ground: 1.0, training: 0.85, bonsai: 0.5 };
export const RULES_LATEST = 2;

/** Katalog nádob. Velikost se sama nemění – nádobu volí pěstitel při přesazení.
 *  Objem v litrech určuje, kolik kořenů se vejde (P.rootPerLiter); rozměry v cm slouží vykreslení:
 *  kulatá = průměr a × výška h, oválná a obdélníková = šířka a × hloubka b × výška h. */
export interface PotSpec {
  id: string; type: PotType; name: string; liters: number;
  shape: 'ground' | 'round' | 'oval' | 'rect'; a: number; b: number; h: number; color: number; glaze: boolean;
}
export const POTS: PotSpec[] = [
  { id: 'ground', type: 'ground', name: 'Volná půda (záhon)', liters: 0, shape: 'ground', a: 0, b: 0, h: 0, color: 0, glaze: false },
  { id: 't05', type: 'training', name: 'Sadbovací kelímek 0,5 l', liters: 0.5, shape: 'round', a: 10, b: 10, h: 9, color: 0x2b2b2d, glaze: false },
  { id: 't2', type: 'training', name: 'Květináč terakota 2 l', liters: 2, shape: 'round', a: 17, b: 17, h: 13, color: 0xa5583a, glaze: false },
  { id: 't5', type: 'training', name: 'Květináč terakota 5 l', liters: 5, shape: 'round', a: 23, b: 23, h: 18, color: 0xa5583a, glaze: false },
  { id: 't10', type: 'training', name: 'Kontejner 10 l', liters: 10, shape: 'round', a: 29, b: 29, h: 22, color: 0x2b2b2d, glaze: false },
  { id: 't25', type: 'training', name: 'Kontejner 25 l', liters: 25, shape: 'round', a: 39, b: 39, h: 29, color: 0x2b2b2d, glaze: false },
  { id: 'b02', type: 'bonsai', name: 'Kulatá miska mame 0,2 l', liters: 0.2, shape: 'round', a: 11, b: 11, h: 3.5, color: 0x6b4634, glaze: false },
  { id: 'b07', type: 'bonsai', name: 'Oválná miska 0,7 l, modrá glazura', liters: 0.7, shape: 'oval', a: 20, b: 15, h: 4, color: 0x3d5266, glaze: true },
  { id: 'b15', type: 'bonsai', name: 'Obdélníková miska 1,5 l, neglazovaná', liters: 1.5, shape: 'rect', a: 27, b: 19, h: 5, color: 0x4f3a30, glaze: false },
  { id: 'b3', type: 'bonsai', name: 'Oválná miska 3 l, zelená glazura', liters: 3, shape: 'oval', a: 36, b: 27, h: 6, color: 0x5d7262, glaze: true },
  { id: 'b6', type: 'bonsai', name: 'Obdélníková miska 6 l, neglazovaná', liters: 6, shape: 'rect', a: 46, b: 33, h: 7.5, color: 0x7a4a36, glaze: false },
  { id: 'b12', type: 'bonsai', name: 'Hluboká obdélníková miska 12 l', liters: 12, shape: 'rect', a: 52, b: 38, h: 11, color: 0x3c3f44, glaze: true },
];
export const potById = (id: string | undefined): PotSpec => POTS.find((p) => p.id === id) ?? POTS[1];
/** Výchozí nádoba pro daný typ (starší uložené hry znají jen typ). */
export const defaultPotId = (type: PotType) => (type === 'ground' ? 'ground' : type === 'training' ? 't5' : 'b15');
export const START_POT = 't05';

export const START_DOY = 90; // výsev 1. dubna
export const MAX_YEARS = 30;
