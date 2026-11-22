# Koncept a architektura

## 1. Cíl

Hráč pěstuje jeden strom od semínka. Hra nemá skóre; odměnou je strom, který vypadá tak,
jak ho hráč svými zásahy vedl. Realističnost stojí na třech pravidlech, která platí pro skutečnou borovici:

1. **Fixní růst.** Délka výhonu je dána pupenem založeným loni v létě. Co hráč udělá letos, projeví se hlavně příští rok.
2. **Omezený rozpočet.** Strom má tolik energie, kolik má osluněných jehlic. Rozpočet se dělí mezi pupeny; kde hráč ubere, jinde přibude.
3. **Bez jehlic není života.** Borovice z holého dřeva neobráží. Větev, na které po řezu nezůstane jehlice ani pupen, odumře.

## 2. Co říkají studie a jak je to v modelu

Poznámka k ověření: plné texty článků nebyly při rešerši dostupné, čísla pocházejí z abstraktů
a sekundárních citací. Hodnoty ve sloupci „V modelu“ jsou kalibrované odhady, ne naměřená data.

| Jev | Literatura | V modelu (`src/sim/params.ts`) |
| --- | --- | --- |
| Fixní růst | Počet článků výhonu se zakládá v pupenu; délku nejlépe předpovídá teplota loňského července [7, 8] | Pupen nese `len` – předurčenou délku. Zakládání pupenů při 800 d.d. |
| Prodlužování výhonů | Řízeno teplotní sumou; ve Finsku končí při 350–450 d.d. (práh +5 °C), trvá 43–59 dní [1–5]. V Tyrolsku rašení 113.–119. den roku [12] | Začátek 60 d.d. (~konec dubna), konec ~550 d.d. (~2. polovina června) |
| Jehlice | Rostou téměř od začátku s výhonem, končí asi měsíc po něm [9]. Délka 3–7 cm, reaguje na podmínky běžného roku | Start 110 d.d., konec ~1000 d.d.; délka 2–5,5 cm podle síly výhonu a nádoby |
| Životnost jehlic | 2–3 roky na 50° s. š., až 7 let na 70° [10, 11] | 3 sezóny, opad v září–říjnu |
| Semenáček | 4–7 děloh; 1. rok primární jehlice, 2. rok svazečky a první přeslen; 2leté sazenice 8–20 cm [13–15] | 5–7 děloh, hypokotyl ~2,5–3 cm, epikotyl roste volně; 2. rok ~12 cm |
| Architektura | Jeden přeslen ročně; délka výhonů klesá od vrcholu ~33 % na přeslen [15, 16]; LIGNUM [17, 18] | Terminál + 0–6 bočních pupenů podle vitality, boční ≈ 0,55 terminálu |
| Dělení zdrojů | Rozšířený Borchert–Honda [21] | Viz kap. 3 |
| Světlo | Stínová voxelová mřížka [21] | Zastíněné výhony slábnou; pod 8 % světla shazují jehlice |
| Tloušťkový růst | Pipe model [19]; Presslerův zákon – přírůst plochy letokruhu ~ olistění nad místem (neplatí obecně [20]); kambium aktivní květen–srpen [6, 12] | Přírůst průřezu každého úseku ~ olistění jeho podstromu. Proto obětní větev zesiluje kmen pod sebou |
| Reakce na řez | Po seříznutí vznikají pupeny ze svazečků jehlic u řezu; při pozdně letním řezu už ne [15, 22, 23] | Po zaštípnutí 1–4 rovnocenné pupeny u řezu; řez po zakládání pupenů je vytvoří až příští léto |
| Zpětné rašení | Praxe: po redukci vrcholů raší pupeny na starším dřevě, které ještě nese jehlice [25–27] | Po řezu šance na 1–2 zpětné pupeny na mateřském výhonu (do 2 let stáří, s jehlicemi) |
| Omezení kořenů | Zdvojnásobení objemu nádoby zvyšuje biomasu asi o 43 % [28] | Nádoba má účinnost a kapacitu: `rozpočet = c·P·účinnost / (1 + P/kapacita)` |

Kalibrace (`npm run calibrate`): ve volné půdě 12 cm ve 2. roce, ~45 cm v 5. roce, ~2,3 m v 10. roce.

## 3. Model růstu

**Struktura.** Strom je seznam *ročních přírůstků* (`Shoot`). Každý zná rodiče, místo nasazení, směr,
délku, průřez dřeva, počet a stav jehlic a své pupeny (`Bud`).

**Rok stromu** (krok simulace je jeden den, fáze řídí teplotní suma):

| Kdy | Co se děje |
| --- | --- |
| ~60 d.d. (duben) | Rašení: z každého pupenu vznikne svíčka s délkou předurčenou loni |
| 60–550 d.d. | Svíčky se prodlužují; jehlice se rozvíjejí a rostou do léta |
| 150–1300 d.d. | Tloušťkový růst |
| 800 d.d. (červenec) | Zakládání pupenů = roční „účetní uzávěrka“ (níže) |
| září–říjen | Opad nejstaršího ročníku jehlic; kontrola odumření |

**Zakládání pupenů:**

1. Spočítá se oslunění každého výhonu (stínová mřížka).
2. Produkce `P` = součet olistění × světlo × účinnost podle stáří jehlic. Z ní rozpočet `G` v cm nových výhonů.
3. `G` se dělí od kořene k vrcholům: v každém větvení dostane pokračující osa váhu 0,78, boční 0,22,
   násobeno „silou“ větve (kolik osluněných vrcholů nese). To je apikální dominance.
4. Z podílu vrcholu vznikne terminální pupen a přeslen bočních. Zaštípnutý vrchol dostane místo toho
   několik rovnocenných slabších pupenů – tak vzniká jemné větvení.

**Zásahy** (`src/sim/actions.ts`): `cut(výhon, t)` – zaštípnutí svíčky i řez staršího dřeva jsou tatáž operace,
liší se jen stavem výhonu; `bud` – vylomení pupenu; `repot` – nádoba, zakrácení kořenů, natočení a náklon;
`wire` / `unwire` – nasazení drátu s ohybem a jeho sundání.

## 3a. Kořeny a přesazování

Stav nese množství kořenů a kapacitu nádoby. Kořeny přirůstají úměrně olistění a zpomalují, jak se nádoba plní.

| Pravidlo v modelu | Opora ve zdrojích (viz poznámka o ověření níže) |
| --- | --- |
| Od 75 % zaplnění nádoby růst slábne, při 160 % klesá na 30 % – strom v misce bez přesazení během let chřadne | Příznaky prokořenění: kořeny krouží, voda neprotéká, růst slábne [P2, P8]. Větší nádoba = víc biomasy (+43 % na zdvojnásobení objemu) [28] |
| Nádoba se volí z katalogu s objemem v litrech a sama se nezvětšuje; litr substrátu pojme pevné množství kořenů. Malá miska se proto zaplní rychle, velký kontejner pomalu | Interval přesazování borovic 2–5 let, mladé častěji [P1, P2] |
| Při přesazení se volí, kolik kořenů zakrátit; stres = (0,1 + podíl zakrácení) × sezónní násobek | Silně zakrácené stromy přirostly první rok o 65 % méně na výšku; u borovice lesní přežívaly stromy s polovinou kořenů jako nezakrácené, při úplném zakrácení nejhůř [P10–P12] |
| Nejšetrnější termín je předjaří při nalévání pupenů (×1), náhradní pozdní léto (×1,3), podzim–zima ×1,6, léto ×2, doba rašení ×2,5 | Předjaří před prodlužováním svíček; u borovice lesní se v Evropě přesazuje i koncem léta [P3, P4] |
| Stres ≥ 1 strom nepřežije; nižší stres snižuje růstový rozpočet a během sezóny odeznívá | Úplné obnažení kořenů jehličnany silně oslabí a může je zabít; část balu má zůstat netknutá kvůli mykorhize [P5–P7] |
| Strom lze otočit a posadit nakřivo. Starý kmen zůstane šikmý, nová svíčka kmene se napřímí | U borovic se měkký vrchol po naklonění napřímí během dnů, zdřevnatělý kmen se rovná jen pomalu tlakovým dřevem [P14–P16]. Šikmý styl (shakan) [P13] |

## 3b. Drátování

Drát se nasazuje na vyzrálý výhon. Tvar ohybu se volí posuvníkem: ostrý zlom v místě nasazení, nebo plynulý
oblouk přes zvolený podíl délky výhonu. Vše, co na výhonu roste, se stočí podle svého místa na oblouku.

| Pravidlo v modelu | Opora ve zdrojích |
| --- | --- |
| Bezpečný ohyb ≈ 28° / (poloměr v cm + 0,25), nejvýš 80°; přes mez roste riziko prasknutí až na 100 % při 1,5násobku. Prasklá větev odumře | Jen zkušenostní pravidla – tenké větve se ohýbají drátem, silné potřebují rafii a kotvicí dráty [P24]. Číselná mez je odhad modelu |
| Plynulý oblouk snese víc než zlom: mez je dána poměrem síly větve k poloměru ohybu (nejvýš 5 %), až do 150° | Odhad modelu; v praxi se silné ohyby rozkládají do delšího oblouku [P24] |
| V době jarního růstu je bezpečný ohyb o 40 % menší | Při aktivním růstu se kůra odděluje od dřeva; borovice se drátují od podzimu do předjaří [P19, P20] |
| Tvar fixuje tloušťkový přírůst: tenká větvička drží po jedné sezóně, každý cm poloměru přidá další. Dřív sundaný drát = větev se úměrně vrátí | Tvar drží až nové dřevo narostlé v ohnuté poloze; borovice fixují pomalu; po předčasném sundání se větve vracejí [P17, P18, P23] |
| Když průřez větve naroste o 45 %, drát zarůstá a zůstane trvalá jizva | Drát se nejrychleji zařezává na jaře u mladých vitálních borovic [P21, P22] |
| Zobrazený drát je měděný, o síle asi 1/3 větve | Pro jehličnany žíhaná měď; síla ~1/3 větve [P17, P18] |

**Poznámka o ověření.** Stránky zdrojů nebyly při rešerši dostupné; tvrzení v těchto dvou tabulkách pocházejí
z úryvků ve výsledcích vyhledávání a z abstraktů. Číselné hodnoty modelu (meze ohybu, násobky stresu, rychlost
fixace) jsou odhady zvolené tak, aby chování odpovídalo popsané praxi.

## 4. Architektura

```
src/sim/      čisté simulační jádro, bez DOM a grafiky (běží i v Node)
  types.ts      datový model – prostá data
  params.ts     druhové parametry borovice lesní
  climate.ts    teplota, kalendář
  light.ts      stínová mřížka
  growth.ts     denní krok, rašení, zakládání pupenů, odumírání
  actions.ts    zásahy pěstitele
  timeline.ts   časová osa
src/render/   view.ts – ze stavu staví 3D geometrii (three.js), kamera, výběr myší
src/main.ts   ovládání, texty, deník
scripts/      sestavení, kalibrace, testy
```

**Časová osa je event sourcing.** Ukládá se jen semínko a deník zásahů. Strom k libovolnému dni
je `f(semínko, zásahy, den)` a dopočítá se přehráním simulace; snapshoty po rocích zrychlují skok zpět.
Důsledky: pohyb v čase oběma směry, vrácení zásahu, uložená hra o pár stovkách bajtů.
Náhoda je hash z id výhonu, takže zásah na jedné větvi nezmění zbytek stromu.

**Tok dat je jednosměrný:** vstup → `Timeline.act/seek` → `State` → `TreeView.setState`. Renderer stav nikdy nemění.

## 5. Kam dál

| Krok | Co je potřeba |
| --- | --- |
| Rafie, kotvicí dráty, více oblouků na jednom výhonu | Nový oblouk dnes nahradí předchozí oblouk téhož výhonu |
| Zalévání a substrát | Prokořenění zatím jen brzdí růst; chybí voda a propustnost substrátu |
| Vyštipování jehlic | Zásah snižující `needleCount`; sníží sílu větve a pustí světlo dovnitř |
| Zalévání, hnojení, zdraví | Další násobitele rozpočtu; délka jehlic podle dusíku |
| Převěšování větví vahou | Směr se počítá při vykreslení z hmotnosti podstromu |
| Samčí šištice, borka, jin a shari | Vizuální vrstva a práce s mrtvým dřevem |
| Další druhy | Nový soubor parametrů; druhy s více růstovými vlnami potřebují jinou fenologii |
| Ověření modelu | Dohledat plné texty a porovnat křivky přírůstu s měřenými daty |

## 6. Zdroje

1. Salminen & Jalkanen 2007, Tree Physiology 27:1347. https://doi.org/10.1093/treephys/27.9.1347
2. Eur J For Res 2023. https://link.springer.com/article/10.1007/s10342-023-01606-4
3. Schiestl-Aalto, Nikinmaa & Mäkelä 2013, Annals of Botany – délka prodlužování výhonů.
4. Schiestl-Aalto et al. 2015, model CASSIA, New Phytologist 206:647. https://doi.org/10.1111/nph.13275
5. Schiestl-Aalto 2017, Dissertationes Forestales. https://dissertationesforestales.fi/article/6996
6. Mäkinen, Jyske & Nöjd 2018, Annals of Forest Science 75:28. https://doi.org/10.1007/s13595-018-0710-1
7. Salminen & Jalkanen 2005, Silva Fennica 39(4):497. https://www.silvafennica.fi/article/362
8. Salminen, Jalkanen & Lindholm 2009, Annals of Forest Science. https://link.springer.com/article/10.1051/forest/2009074
9. Schiestl-Aalto & Mäkelä 2016, Tree Physiology. https://doi.org/10.1093/treephys/tpw120
10. Oleksyn et al. 2003, Oecologia. https://link.springer.com/doi/10.1007/s00442-003-1265-9
11. Jalkanen et al. 1995, Trees. https://link.springer.com/article/10.1007/BF00192193
12. Gruber et al. 2010, Tree Physiology. https://pubmed.ncbi.nlm.nih.gov/20197285/
13. Elwes & Henry, The Trees of Great Britain & Ireland, sv. 3, *Pinus sylvestris*.
14. Thompson 1981, Environmental control over the shoot growth of pine seedlings.
15. Skilling, Scotch Pine, Silvics of North America. https://research.fs.usda.gov/silvics/scotch-pine
16. Kalén, Wildlife Biology. https://doi.org/10.1002/wlb3.01719
17. Perttunen et al. 1996, LIGNUM, Annals of Botany 77:87. https://doi.org/10.1006/anbo.1996.0011
18. Perttunen, Sievänen & Nikinmaa 1998, Ecological Modelling 108:189.
19. Shinozaki et al. 1964, Japanese Journal of Ecology 14:97.
20. Lehnebach et al. 2018, Annals of Botany 121:773. https://academic.oup.com/aob/article/121/5/773/4820933
21. Palubicki et al. 2009, Self-organizing tree models for image synthesis, ACM TOG 28(3):58. https://doi.org/10.1145/1531326.1531364
22. Journal of Forestry 64(2):126 – termín seřezávání (autoři neověřeni).
23. Tree Planters' Notes 29(2). https://npn.rngr.net/publications/tpn/29-2/29_2_9_12.pdf
25. Bonsai Empire, Pines. https://www.bonsaiempire.com/tree-species/pines
26. Bjorholm, evropské borovice. https://www.bjornbjorholm.com/care-and-maintenance-guide-for-native-european-pine-bonsai-pinus/
27. Hagedorn. https://crataegus.com/2016/04/14/big-difference-between-decandling-and-breaking-pine-shoots/
28. Poorter et al. 2012, Functional Plant Biology 39:839. https://juser.fz-juelich.de/record/20247

Zdroje k přesazování a drátování (ověřeno jen z úryvků):

- P1. RHS, Bonsai. https://www.rhs.org.uk/plants/types/trees/bonsai
- P2. Bonsai Tree Gardener, Repotting. https://www.bonsaitreegardener.net/care/how-to/repotting
- P3. Bonsai Galinou, Scots pine. https://www.bonsaigalinou.com/en/blog-module?id=112
- P4. Shohin Europe, Summer repotting Scots pine. https://shohin-europe.com/2022/08/11/summer-repotting-scots-pine/
- P5. Bonsai Tonight, Repotting black pine in nursery soil. https://bonsaitonight.com/2015/04/14/repotting-black-pine-in-nursery-soil/
- P6. Bonsai Mirai, Repotting conifers. https://bonsaimirai.com/blog/repotting-conifers
- P7. Scottish Bonsai Association. https://scottishbonsai.org/Atoz/AtoZCare.cfm?id=605
- P8. Bonsai Tonight, Signs it's time to repot. https://bonsaitonight.com/2018/02/20/signs-time-repot/
- P10. Gilman et al., UF/IFAS – řez kořenů a přírůst. https://hort.ifas.ufl.edu/woody/documents/articles/GilmanHarchickPazAUF2010.pdf
- P11. Buraczyk & Kapuścińska – řez kořenů semenáčků borovice lesní.
- P12. Brown, disertace MSU – přežívání borovice lesní po řezu kořenů. https://d.lib.msu.edu/etd/34669/FULL_TEXT/view
- P13. Bonsai styles. https://www.bonsaiempire.com/origin/bonsai-styles
- P14. Herrera et al. 2010, BMC Plant Biology 10:217. https://dx.doi.org/10.1186/1471-2229-10-217
- P15. Ba, Salin, Fourcaud & Stokes 2010, IAWA Journal 31(4):465. https://hal.inrae.fr/hal-02663092
- P16. Archer & Wilson 1973. https://pmc.ncbi.nlm.nih.gov/articles/PMC366344
- P17. Harrington, Wiring Bonsai. https://bonsai4me.com/wiring-bonsai/ ; Bonsai Empire. https://bonsaiempire.com/basics/styling/wiring
- P18. Bonsai Learning Center, Wire. https://bonsailearningcenter.com/wire/
- P19. Bonsai Tonight, Fall work basics: black and red pine. https://bonsaitonight.com/2025/01/04/fall-work-basics-black-and-red-pine/
- P20. BonsaiNut, diskuse o termínu drátování (fórum).
- P21. Arnold Arboretum, Bonsai and Penjing Collection care. https://arboretum.harvard.edu/plants/bonsai-penjing-collection-care
- P22. Bonsai Tonight, Swelling on recently wired branches. https://bonsaitonight.com/2015/06/02/looking-out-for-swelling-on-recently-wired-branches/
- P23. Fire Escape Bonsai, Wire scars. https://fireescapebonsai.substack.com/p/wire-scars
- P24. Eastern Leaf, Heavy bends with guy wire. https://blog.easternleaf.com/heavy-bends-with-guy-wire
