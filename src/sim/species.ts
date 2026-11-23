// Druhy. Borovice lesní používá původní parametry v params.ts (P); ostatní druhy jsou „olistěné“:
// pupeny v úžlabí listů podél výhonu, listy (nebo jehlice modřínu) jen na jednu sezónu, krátké výhony
// (brachyblasty) na starším dřevě a spící pupeny, ze kterých strom po řezu obráží.
// Zdroje a míra ověření hodnot: docs/KONCEPT.md.

export type SpeciesId = 'pine' | 'larch' | 'hornbeam' | 'beech' | 'oak' | 'birch' | 'maple';
export type LeafShape = 'needle' | 'ovate' | 'beech' | 'lobed' | 'delta' | 'palmate' | 'tuft';

export interface Species {
  id: SpeciesId; name: string; latin: string; about: string; care: string;
  kind: 'pine' | 'leafy';
  foliageWord: [string, string]; // „listy“, „listů“ / „jehlice“, „jehlic“
  // --- fenologie (teplotní suma nad +5 °C od 1. ledna, dny v roce)
  flushGdd: number; elongSpanGdd: number; leafSpanGdd: number; budSetGdd: number;
  colorDoy: number; fallDoy: number;
  marcescent: number; // podíl suchých listů, které zůstanou přes zimu (buk, habr, dub)
  // --- stavba
  internode: number; // cm mezi listy na dlouhém výhonu
  phyllotaxis: 'distichous' | 'spiral' | 'opposite';
  tipCluster: number; // 0..1 nakolik se silné pupeny tísní u vrcholu (dub)
  branchAngle: number; // rad od mateřské osy
  lambdaLateral: number; // váha bočních os proti hlavní (menší = silnější vrcholová dominance)
  maxLaterals: number; lateralRatio: number; lateralDecay: number; minLateral: number;
  apicalUp: number; // síla napřimování kmene
  sag: number; // násobek prověšování větví
  // --- olistění
  leafShape: LeafShape; leafLen: number; leafWidth: number; // cm, poměr šířky k délce
  leafUnits: number; // olistění jednoho plně vyvinutého listu (jednotka = 1 cm výhonu borovice s jehlicemi)
  spurLeaves: number; // listů na jeden krátký výhon; spurYears = kolik let krátké výhony na dřevě žijí
  spurYears: number;
  leafColor: [number, number, number]; springColor: [number, number, number]; autumnColor: [number, number, number];
  flushColor: [number, number, number]; // právě rozvíjející se list na špičce výhonu (u habru, dubu a javoru bronzový)
  // --- fyziologie
  growthPerFoliage: number; lightDeath: number;
  thicken: number; // násobek tloušťkového přírůstu na jednotku olistění (listnáče mají olistění víc než borovice)
  epicormic: number; // ochota obrážet ze spících pupenů na starém holém dřevě (0..1)
  backbud: number; // ochota zpětně rašit po řezu v okolí
  reflush: number; // druhý růst téže sezóny po zaštípnutí (0 = žádný)
  dieback: number; // riziko, že řezaná větvička zaschne až k větvení (bříza); mimo dobu olistění trojnásobné
  repotStress: number; // násobek stresu z přesazení (modřín snáší zásah do kořenů špatně, babyka dobře)
  wireBite: number; // poměr průřezu, při kterém drát zarůstá (buk a habr mají tenkou kůru)
  maxLeader: number; maxLateral: number; twig0: number; twigPerLen: number;
  // --- dřevo
  twigColor: [number, number, number]; barkColor: [number, number, number]; oldBarkColor: [number, number, number];
  barkRough: number; barkAge: number; // drsnost borky 0..1 a stáří, kdy se začne tvořit
  budColor: [number, number, number]; budLen: number; budFat: number;
  // --- semenáček
  hypogeal: boolean; cotyledons: number; cotyledonLen: number; hypocotylLen: number; epicotylLen: number;
}

const leafy = (o: Partial<Species> & Pick<Species, 'id' | 'name' | 'latin' | 'about' | 'care'>): Species => ({
  kind: 'leafy', foliageWord: ['Listy', 'listů'],
  flushGdd: 120, elongSpanGdd: 600, leafSpanGdd: 260, budSetGdd: 850, colorDoy: 283, fallDoy: 310, marcescent: 0,
  internode: 2.5, phyllotaxis: 'spiral', tipCluster: 0.2, branchAngle: 0.95, lambdaLateral: 0.36,
  maxLaterals: 6, lateralRatio: 0.62, lateralDecay: 0.75, minLateral: 2.0, apicalUp: 0.3, sag: 1,
  leafShape: 'ovate', leafLen: 7, leafWidth: 0.55, leafUnits: 2.2, spurLeaves: 1.4, spurYears: 4,
  leafColor: [0.25, 0.47, 0.2], springColor: [0.36, 0.52, 0.16], autumnColor: [0.85, 0.7, 0.2], flushColor: [0.42, 0.52, 0.2],
  growthPerFoliage: 3.5, thicken: 0.22, lightDeath: 0.05, epicormic: 0.7, backbud: 0.7, reflush: 0.5, dieback: 0, repotStress: 1, wireBite: 1.45,
  maxLeader: 70, maxLateral: 45, twig0: 0.05, twigPerLen: 0.0045,
  twigColor: [0.42, 0.36, 0.26], barkColor: [0.5, 0.48, 0.44], oldBarkColor: [0.42, 0.4, 0.37], barkRough: 0.2, barkAge: 12,
  budColor: [0.5, 0.33, 0.2], budLen: 0.45, budFat: 0.28,
  hypogeal: false, cotyledons: 2, cotyledonLen: 1.6, hypocotylLen: 3, epicotylLen: 6,
  ...o,
});

export const SPECIES: Record<SpeciesId, Species> = {
  // Borovice: růst řídí params.ts; zde jen popis a vzhledové údaje používané společným kódem.
  pine: {
    ...leafy({ id: 'pine', name: 'Borovice lesní', latin: 'Pinus sylvestris',
      about: 'Světlomilný jehličnan s přesleny větví. Roste jednou ročně ze svíček; z holého dřeva neobráží.',
      care: 'Zaštipování svíček na jaře, výběr pupenů na podzim, drát od podzimu do předjaří. Nikdy neřezat do dřeva bez jehlic.' }),
    kind: 'pine', foliageWord: ['Jehlice', 'jehlic'], flushGdd: 60, elongSpanGdd: 490, budSetGdd: 800, leafShape: 'needle',
    epicormic: 0, backbud: 0.45, reflush: 0,
  },
  larch: leafy({ id: 'larch', name: 'Modřín opadavý', latin: 'Larix decidua',
    about: 'Opadavý jehličnan. Na dlouhých výhonech jednotlivé jehlice, na starším dřevě svazečky na krátkých výhonech; na podzim zlatě žloutne.',
    care: 'Zaštipovat dlouhé výhony během růstu, svazečky nechat. Drátovat v bezlistém stavu. Obráží i ze staršího dřeva, kde zůstaly krátké výhony.',
    foliageWord: ['Jehlice', 'jehlic'], flushGdd: 45, elongSpanGdd: 1000, leafSpanGdd: 220, colorDoy: 290, fallDoy: 318,
    internode: 0.9, phyllotaxis: 'spiral', tipCluster: 0.1, branchAngle: 1.2, lambdaLateral: 0.26, maxLaterals: 7, lateralRatio: 0.55, lateralDecay: 0.85,
    apicalUp: 0.4, sag: 1.3, leafShape: 'tuft', leafLen: 2.6, leafWidth: 0.04, leafUnits: 0.55, spurLeaves: 1, spurYears: 15,
    leafColor: [0.33, 0.56, 0.27], springColor: [0.52, 0.74, 0.3], autumnColor: [0.9, 0.72, 0.18],
    growthPerFoliage: 4.6, thicken: 0.5, lightDeath: 0.11, epicormic: 0.45, backbud: 0.7, reflush: 0.5, repotStress: 1.5, maxLeader: 80,
    twigColor: [0.72, 0.62, 0.38], barkColor: [0.52, 0.38, 0.3], oldBarkColor: [0.46, 0.32, 0.27], barkRough: 0.85, barkAge: 6,
    budColor: [0.45, 0.3, 0.2], budLen: 0.25, budFat: 0.45, cotyledons: 6, cotyledonLen: 1.4, hypocotylLen: 2.5, epicotylLen: 4 }),
  hornbeam: leafy({ id: 'hornbeam', name: 'Habr obecný', latin: 'Carpinus betulus',
    about: 'Stínomilný listnáč s jemným dvouřadým větvením a rýhovaným šedým kmenem. Ochotně obráží, proto je to vděčná bonsaj.',
    care: 'Nové výhony zkracovat na 2 listy, po zaštípnutí znovu vyraší. Suché listí drží přes zimu. Kůra je tenká – drát hlídat.',
    flushGdd: 115, elongSpanGdd: 800, colorDoy: 285, fallDoy: 312, marcescent: 0.55,
    internode: 2.2, phyllotaxis: 'distichous', branchAngle: 0.95, lambdaLateral: 0.4, leafShape: 'ovate', leafLen: 7, leafWidth: 0.52, leafUnits: 2.1,
    leafColor: [0.26, 0.5, 0.2], autumnColor: [0.86, 0.7, 0.2], flushColor: [0.5, 0.38, 0.2], growthPerFoliage: 3.2, lightDeath: 0.03, epicormic: 0.85, backbud: 0.85, reflush: 0.6, repotStress: 0.9, wireBite: 1.25,
    twigColor: [0.4, 0.33, 0.25], barkColor: [0.64, 0.64, 0.6], oldBarkColor: [0.58, 0.58, 0.55], barkRough: 0.7, barkAge: 6,
    budColor: [0.5, 0.36, 0.22], budLen: 0.5, budFat: 0.22, hypocotylLen: 3, epicotylLen: 6 }),
  beech: leafy({ id: 'beech', name: 'Buk lesní', latin: 'Fagus sylvatica',
    about: 'Velmi stínomilný listnáč s hladkou stříbřitou kůrou. Roste jednou ročně z dlouhých špičatých pupenů a zpočátku pomalu.',
    care: 'Jediný růst za rok: zaštípnout, když se pupeny otevírají, nechat 2–3 listy. Ze starého dřeva obráží neochotně – neřezat do holého.',
    flushGdd: 175, elongSpanGdd: 320, colorDoy: 280, fallDoy: 310, marcescent: 0.8,
    internode: 3, phyllotaxis: 'distichous', branchAngle: 1.05, lambdaLateral: 0.36, maxLaterals: 5, leafShape: 'beech', leafLen: 8, leafWidth: 0.62, leafUnits: 3.1,
    spurYears: 8, leafColor: [0.22, 0.46, 0.18], springColor: [0.38, 0.53, 0.18], autumnColor: [0.72, 0.42, 0.16],
    growthPerFoliage: 2.7, lightDeath: 0.025, epicormic: 0.3, backbud: 0.45, reflush: 0.3, wireBite: 1.2,
    twigColor: [0.4, 0.3, 0.22], barkColor: [0.74, 0.75, 0.73], oldBarkColor: [0.7, 0.71, 0.7], barkRough: 0.6, barkAge: 6,
    budColor: [0.55, 0.36, 0.2], budLen: 1.1, budFat: 0.16, cotyledonLen: 2.4, hypocotylLen: 6, epicotylLen: 5 }),
  oak: leafy({ id: 'oak', name: 'Dub letní', latin: 'Quercus robur',
    about: 'Světlomilný dlouhověký listnáč. Pupeny se tísní u konce výhonu, v červnu často roste podruhé (jánské výhony) a kůra časem hluboce rozpraská.',
    care: 'Řez po vyzrání prvního růstu; obráží ochotně i ze starého dřeva. Raší pozdě. Listy se v misce zmenšují jen částečně.',
    flushGdd: 200, elongSpanGdd: 320, colorDoy: 290, fallDoy: 318, marcescent: 0.55,
    internode: 2.4, phyllotaxis: 'spiral', tipCluster: 0.85, branchAngle: 0.9, lambdaLateral: 0.42, maxLaterals: 5, lateralRatio: 0.7,
    leafShape: 'lobed', leafLen: 10, leafWidth: 0.55, leafUnits: 3.4, leafColor: [0.23, 0.43, 0.18], springColor: [0.4, 0.5, 0.19], autumnColor: [0.62, 0.42, 0.18], flushColor: [0.5, 0.34, 0.2],
    growthPerFoliage: 2.7, lightDeath: 0.07, epicormic: 0.9, backbud: 0.8, reflush: 0.7,
    twigColor: [0.4, 0.36, 0.28], barkColor: [0.46, 0.42, 0.36], oldBarkColor: [0.38, 0.33, 0.29], barkRough: 1, barkAge: 12,
    budColor: [0.55, 0.4, 0.25], budLen: 0.45, budFat: 0.5, hypogeal: true, cotyledons: 0, hypocotylLen: 0.5, epicotylLen: 11 }),
  birch: leafy({ id: 'birch', name: 'Bříza bělokorá', latin: 'Betula pendula',
    about: 'Rychle rostoucí světlomilný pionýr s bílou kůrou a převislými větvičkami. Roste celé léto.',
    care: 'Řezat v listu, ne v předjaří (silně slzí). Větvičky po řezu rády zasychají a ze starého dřeva obráží špatně – nejtěžší druh ve hře.',
    flushGdd: 70, elongSpanGdd: 1100, colorDoy: 275, fallDoy: 302,
    internode: 2.6, phyllotaxis: 'spiral', branchAngle: 0.8, lambdaLateral: 0.3, maxLaterals: 6, lateralRatio: 0.55, apicalUp: 0.4, sag: 3,
    leafShape: 'delta', leafLen: 5, leafWidth: 0.78, leafUnits: 1.3, spurYears: 5, leafColor: [0.3, 0.52, 0.2], springColor: [0.38, 0.53, 0.18], autumnColor: [0.92, 0.78, 0.2],
    growthPerFoliage: 5.4, thicken: 0.35, lightDeath: 0.12, epicormic: 0.25, backbud: 0.35, reflush: 0.5, dieback: 0.22, maxLeader: 85, twig0: 0.04, twigPerLen: 0.0035,
    twigColor: [0.42, 0.26, 0.2], barkColor: [0.9, 0.89, 0.85], oldBarkColor: [0.86, 0.85, 0.82], barkRough: 1, barkAge: 7,
    budColor: [0.45, 0.33, 0.2], budLen: 0.35, budFat: 0.3, cotyledonLen: 0.6, hypocotylLen: 1.5, epicotylLen: 8 }),
  maple: leafy({ id: 'maple', name: 'Javor babyka', latin: 'Acer campestre',
    about: 'Nenáročný listnáč se vstřícným větvením, dlanitými listy a korkovitou kůrou. Dobře snáší řez i sucho.',
    care: 'Zkracovat na 1–2 páry listů; obráží ochotně a po řezu roste znovu. Vstřícné pupeny dávají vidlice – jeden z páru odstraňovat.',
    flushGdd: 120, elongSpanGdd: 650, colorDoy: 285, fallDoy: 308,
    internode: 3, phyllotaxis: 'opposite', branchAngle: 0.85, lambdaLateral: 0.4, maxLaterals: 6, lateralRatio: 0.65,
    leafShape: 'palmate', leafLen: 6, leafWidth: 1.0, leafUnits: 2.2, leafColor: [0.25, 0.48, 0.2], autumnColor: [0.9, 0.72, 0.18], flushColor: [0.5, 0.33, 0.22],
    growthPerFoliage: 2.8, lightDeath: 0.05, epicormic: 0.85, backbud: 0.85, reflush: 0.7, repotStress: 0.7,
    twigColor: [0.45, 0.36, 0.24], barkColor: [0.6, 0.5, 0.38], oldBarkColor: [0.52, 0.44, 0.34], barkRough: 0.8, barkAge: 6,
    budColor: [0.5, 0.3, 0.22], budLen: 0.35, budFat: 0.35, cotyledonLen: 2.2, hypocotylLen: 4, epicotylLen: 6 }),
};
export const SPECIES_ORDER: SpeciesId[] = ['pine', 'larch', 'hornbeam', 'beech', 'oak', 'birch', 'maple'];
export const speciesOf = (s: { species?: string }): Species => SPECIES[(s.species as SpeciesId) ?? 'pine'] ?? SPECIES.pine;
