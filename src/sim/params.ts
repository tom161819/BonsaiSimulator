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

  maxShoots: 7000,
};

/** growth = účinnost kořenů, capacity = olistění, při kterém je nádoba prokořeněná
 *  (rozpočet = c·P·growth / (1 + P/capacity) – nasycení růstu v malé nádobě). */
export const POT: Record<PotType, { name: string; growth: number; capacity: number; needle: number }> = {
  ground: { name: 'Volná půda', growth: 1.0, capacity: 1e7, needle: 1.0 },
  training: { name: 'Pěstební nádoba', growth: 0.9, capacity: 250, needle: 0.9 },
  bonsai: { name: 'Bonsajová miska', growth: 0.75, capacity: 25, needle: 0.72 },
};

export const START_DOY = 90; // výsev 1. dubna
export const MAX_YEARS = 30;
