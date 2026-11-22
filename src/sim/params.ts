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
  bendSpringFactor: 0.6, // v době jarního růstu se kůra snadno odlupuje – menší bezpečný ohyb

  maxShoots: 7000,
};

/** growth = jak dobře substrát strom živí (mělká miska hůř než hluboká nádoba).
 *  rootRoom = kolikanásobek současného olistění uživí kořeny v čerstvě přesazené nádobě;
 *  miska je těsná, proto se v ní kořeny při přesazení musí zakracovat.
 *  Jak se nádoba plní kořeny, růst slábne (viz rootBound*). */
export const POT: Record<PotType, { name: string; growth: number; needle: number; rootRoom: number; minCap: number }> = {
  ground: { name: 'Volná půda', growth: 1.0, needle: 1.0, rootRoom: 1e6, minCap: 1e9 },
  training: { name: 'Pěstební nádoba', growth: 0.85, needle: 0.9, rootRoom: 3, minCap: 40 },
  bonsai: { name: 'Bonsajová miska', growth: 0.5, needle: 0.72, rootRoom: 1.5, minCap: 15 },
};

export const START_DOY = 90; // výsev 1. dubna
export const MAX_YEARS = 30;
