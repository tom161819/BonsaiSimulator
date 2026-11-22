// Datový model simulace. Vše jsou prostá data (žádné třídy, žádné odkazy na renderer),
// takže stav lze klonovat (snapshoty časové osy), serializovat a přehrávat deterministicky.

export type Vec3 = [number, number, number];

/** Kde strom roste – omezení kořenů je hlavní "plyn/brzda" růstu. */
export type PotType = 'ground' | 'training' | 'bonsai';

/** hypokotyl = stonek pod dělohami, epikotyl = první rok nad dělohami (volný růst), shoot = roční přírůstek */
export type ShootKind = 'hypocotyl' | 'epicotyl' | 'shoot';

export type BudKind = 'terminal' | 'lateral' | 'pinch' | 'back';

/** Pupen: obsahuje už předurčenou délku příštího výhonu (fixní růst borovice). */
export interface Bud {
  id: number;
  kind: BudKind;
  /** poloha na mateřském výhonu 0..1 (1 = vrchol) */
  t: number;
  dir: Vec3;
  /** předurčená délka výhonu v cm */
  len: number;
  order: number;
  isMain: boolean;
}

/** Roční přírůstek (růstová jednotka) – základní stavební prvek stromu. */
export interface Shoot {
  id: number;
  parent: number; // id rodiče, -1 = kořenový
  attachT: number; // místo na rodiči 0..1
  dir: Vec3; // směr ve světových souřadnicích (Y nahoru)
  order: number; // 0 = kmen, 1 = větev, 2 = větvička…
  isMain: boolean; // pokračování osy rodiče (terminál)
  kind: ShootKind;
  bornYear: number;
  bornDay: number;
  targetLen: number; // cílová délka po dorůstu (cm)
  len: number; // aktuální délka (cm)
  elong: boolean; // právě se prodlužuje (svíčka)
  delay: number; // zpoždění rašení v denních stupních
  gdd0: number; // teplotní suma při vzniku (jen epikotyl)
  needleCount: number; // počet svazečků (u děloh/primárních jehlic počet jehlic)
  needleLen: number; // cílová délka jehlic (cm)
  needleLive: number; // 0..1 podíl živých jehlic
  shedding: boolean; // zastíněný výhon – jehlice letos opadají
  area: number; // průřez dřeva v cm²
  dead: boolean;
  deadYear: number;
  tipCut: boolean; // vrchol odstraněn (zaštípnutí / řez)
  stimulus: number; // podnět k tvorbě zpětných pupenů po řezu
  light: number; // 0..1 oslunění
  fol: number; // olistění celého podstromu (cache pro tloušťkový růst)
  buds: Bud[];
}

export type Stage = 'seed' | 'growing' | 'dead';

export interface State {
  seed: number;
  day: number; // absolutní den od 1. ledna roku 0
  gdd: number; // teplotní suma od začátku roku (°C·den nad +5 °C)
  nextId: number;
  pot: PotType;
  stage: Stage;
  shoots: Shoot[];
  flushedYear: number;
  budSetYear: number;
  budSetGdd: number;
  /** poslední spočtená produkce a růstový rozpočet (pro UI) */
  production: number;
  budget: number;
}

export type Action =
  | { day: number; type: 'cut'; shoot: number; t: number; label?: string }
  | { day: number; type: 'bud'; shoot: number; bud: number; label?: string }
  | { day: number; type: 'repot'; pot: PotType; label?: string };

export type ActionInput =
  | { type: 'cut'; shoot: number; t: number; label?: string }
  | { type: 'bud'; shoot: number; bud: number; label?: string }
  | { type: 'repot'; pot: PotType; label?: string };
