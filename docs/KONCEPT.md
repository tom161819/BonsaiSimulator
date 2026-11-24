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

## 3c. Prověšování, kořeny, šištice, vítr

| Jev | V modelu |
| --- | --- |
| Prověšování větví | Na konci sezóny se každá boční větev skloní o úhel úměrný olistění, které nese, a nepřímo úměrný průřezu (nejvýš 2,5° za rok, vlastním sklonem ne pod vodorovnou). Tenká zatížená větev klesá, zesílená drží. Nadrátovaná větev se neprověšuje |
| Povrchové kořeny | Při vyklíčení vznikne 5–7 kořenů s různým směrem, délkou a silou. Otáčejí se se stromem a při přesazení je lze rozprostřít rovnoměrně do stran (tvorba nebari) |
| Šištice | Od 8. roku: slabší boční letorosty nesou samčí šištice (žluté, v červnu práší, pak zhnědnou), silné letorosty šišku, která zraje do třetího roku |
| Vítr | Jen vykreslení: kolébání koruny a chvění jehlic; simulaci neovlivňuje a jde vypnout |

Číselné hodnoty těchto čtyř jevů jsou odhady modelu, bez opory v rešerši.

## 3d. Vzorová sbírka a „zahradník“

`scripts/gardener.ts` hraje hru stejnými zásahy, jaké má hráč, podle postupu běžného u borovic:
roky ve volné půdě, koruna držená od mládí kompaktní zaštipováním, kmen zesílený jednou obětní větví,
výběr větví z přeslenů, drátování kmene a větví, přesazení do misky a pravidelné zakracování kořenů.
Vzniklé uložené hry (semínko + deník) jsou ve `src/samples.json`; test hlídá, že se přehrají do stejného stromu.

Při ladění zahradníka se ukázaly a opravily tři slabiny modelu: strom v misce chřadl i při rozumné péči
(účinnost misky 0,5 → 0,75), slabé výhony se nevětvily (větev se větví už od 2 cm na boční výhon) a rozpočet
připadající na neživotaschopné pupeny se ztrácel (nově se přerozdělí mezi zbylé). Po seříznutí vrcholu navíc
osu převezme nejsilnější boční větev a napřímí se.

### Pravidla bonsajové estetiky, podle kterých zahradník staví

Ověřeno jen z úryvků ve výsledcích vyhledávání (stránky nebyly dostupné); autoři je sami označují za vodítka, ne zákony.

| Pravidlo | Zdroj | Jak ho zahradník plní |
| --- | --- | --- |
| Kmen se k vrcholu zužuje a má pohyb; nevrací se „do sebe“ | Walston, Evergreen Gardenworks | Plán ohybů vlevo–vpravo–vlevo vedený drátem, obětní větev u paty |
| Moyogi: vrchol nad patou kmene, lehce k divákovi | Wikipedia – Bonsai styles; Walston | Poslední úsek kmene míří drátem nad patu a mírně dopředu |
| Výška ≈ 6× průměr kmene (často 6–10×) | Walston | Výsledek 55 cm / 41 mm ≈ 13× – pravidlo nesplněno |
| První větev v 1/3 výšky, každá další o 1/3 zbývající vzdálenosti výš | Walston | Rozestupy větví se počítají přesně takto |
| Větve z vnějších stran ohybů, žádné protilehlé ani přesleny, dole žádná k divákovi | Walston; Harrington, bonsai4me | Z každého přeslenu zůstane jedna větev, vybraná podle vnější strany ohybu a střídání stran |
| Větve se směrem vzhůru zkracují a slábnou; silueta nepravidelný trojúhelník | Harrington; Wikipedia | Délka větví klesá s výškou; síla se vyrovnává prořezáváním vrcholu |
| U jehličnanů větve skloněné dolů, nejvíc dole | praxe (bez číselného zdroje) | Drátování do sklonu, který se k vrcholu zmenšuje |
| Miska dlouhá ≈ 2/3 výšky stromu, hluboká ≈ průměr kmene; pro borovice neglazovaná | Bonsai Empire (zrcadlo stránky) | Obdélníková neglazovaná 34 × 24 × 5,5 cm |

**Pravidla v3 – soběstačnost větví.** Při stavbě podle pravidel spodní větve stále slábly: rozpočet se dělil
jen shora podle síly vrcholů. Ve v3 zůstává polovina rozpočtu ve větvi, která ji svým jehličím vyrobila
(princip uhlíkové autonomie větví), zbytek se dělí jako dřív. Hodnota 0,5 je odhad.
**Pravidla v5 – mladistvá vitalita.** Listnáče a modřín ve v3–v4 startovaly příliš pomalu (modřín 29 cm v pěti letech).
Ve v5 má malý stromek na jednotku olistění několikanásobně větší přírůst (podle druhu 1,2–4×, nejvíc bříza a modřín);
výhoda mizí s velikostí koruny. Ve volné půdě vychází v pěti letech 1,6–3 m. Husté koruny se samy prosvětlují
a tloušťkový přírůst je o 40 % menší. Borovice se nemění.
**Pravidla v6 – tolerantnější drátování.** Růst je stejný jako ve v5. Bezpečný ohyb je asi o 60 % větší
(45/(r+0,25)° místo 28, nejméně 15° místo 8°), v době růstu se snižuje jen na 80 % (dřív 60 %) a riziko prasknutí
dosáhne 100 % až při dvojnásobku bezpečného ohybu (dřív při 1,5násobku). Herní ústupek, ne údaj z literatury.
**Pravidla v7 – vrcholová dominance olistěných druhů.** Měření na habru ve 2l nádobě (v6): 62 % ročního přírůstku
šlo do spodní třetiny výšky a jen 11 % do horní; kmen zkrácený nad staršími větvemi už nikdy nevyhnal nový vrchol
(pravidlo v4 považovalo staré větve za „pahýl už obrazil“). Ve v7: (1) váha vrcholu roste s výškou ve stromě
(0,5 u země až 1,6 nahoře, exponent 1,5; v průměru 1), stejně se váží i podíl, který si větev nechává z vlastní
produkce; (2) slabé vrcholy ve spodních patrech pupen nezaloží a zůstanou krátkými výhony, dole vzniká i méně
bočních pupenů; (3) zkrácený kmen vyrazí nový vůdčí výhon, i když pod řezem větve jsou, a ten táhne aspoň jako
2 % všech vrcholů. Výsledek na stejném habru: dole 36 %, nahoře 29 %, počet nových výhonů dole 285 → 165;
po zkrácení kmene roste nový vrchol 6–12 cm ročně. Borovice se nemění. Hodnoty jsou odhad laděný měřením.
**Pravidla v8 – opakované drátování.** Růst je stejný jako ve v7. Ve v1–v7 se při druhém drátování obloukem
počítalo riziko prasknutí z celého ohybu od rovné větve a po předčasném sundání drátu se větev vracela k rovné,
i když první ohyb už zdřevnatěl. Ve v8 je výchozím stavem tvar, který dřevo drží (zarostlý oblouk plus
zdřevnatělý podíl ohybu pod drátem): riziko se počítá jen ze změny proti němu, nový drát fixuje jen tuto změnu
a po sundání se větev vrací k drženému tvaru. Změna poloměru oblouku se do namáhání nepočítá (zjednodušení).
**Pravidla v9 – nádoba růst opravdu omezuje.** Měření ve v8 (javor ze semene v 25l kontejneru, bez zásahů):
v 5 letech 2,1 m a kmen 16 mm (odpovídá školkařské praxi), ale ve 21 letech 13,3 m a kmen 223 mm. Tři příčiny:
násobitel růstu neklesl pod 0,3 a zaplnění mělo strop 180 %, tloustnutí se řídilo jen olistěním a vůdčí výhon
dostal každý rok plnou délku. Ve v9:

| Kořeny v nádobě | do 50 % | 70 % | 100 % | 150 % | 200 % a víc |
| --- | --- | --- | --- | --- | --- |
| podíl růstu | 100 % | 90 % | 55 % | 15 % | 3 % |

Stejný podíl brzdí i tloustnutí (nejméně desetina), nejdelší možný výhon klesá s mocninou 1,5 (přerostlý strom
přirůstá do výšky jen pár cm ročně) a listy i jehlice jsou až o 20 % menší. Kořeny mohou nádobu přeplnit do 220 %
a ročně jich pětina odumírá – díky této zpětné vazbě se strom ustálí kolem 130–170 % a stagnuje, místo aby se
zhroutil. Počítadlo `bound` měří roky v přerostlé nádobě (běží od 120 %, naplno od 150 %): první 3 roky strom jen
stagnuje, dalších 7 let chřadne (růst klesá k nule, každý podzim odumře 6–40 % nejslabších koncových větviček,
substrát je vyčerpaný a kořeny už neodumírají) a pak uhyne. Přesazení, po kterém kořeny zabírají méně než 120 %
nádoby, počítadlo vynuluje; přeplněná nádoba dá jen odklad. Výsledek (javor, 25 l): ustálení na 2,8 m a kmeni
24 mm, při přesazování se zkrácením kořenů o polovinu každé 3 roky 3,6 m a 39 mm ve 21 letech. Tloušťka kmene při ustálení
vychází úměrná zhruba odmocnině objemu nádoby. Běžná bonsaj (miska 2,5 l, zimní řez, přesazení po 3 letech)
se drží na 125–160 % a tloustne asi 0,25 mm ročně.
Podklady: Poorter et al. 2012 (metaanalýza 65 studií: dvojnásobná nádoba = +43 % biomasy, dřeviny jako byliny);
pokusy s omezením kořenů u broskvoně a jabloně (kořeny i nadzemní část se brzdí stejným dílem, méně a menší listy).
Dlouhodobá měřená data pro strom ponechaný desítky let v jedné nádobě jsme nenašli – doba stagnace a chřadnutí
i cílové velikosti jsou odhad podle školkařské a bonsajové praxe.
**Pravidla v10 – stín v koruně a velikost listů.** Měření ve v9 (javor v 5l nádobě, zkrácený kmen, pět let
zastřihávání všech výhonů dvakrát ročně): v nejhustším místě (koule o průměru 12 cm) vycházelo 50–86 m² listové
plochy na m³ a 4–7 m² listů na m² půdorysu. Husté koruny skutečných stromů mají řádově jednotky m²/m³ (laserová
měření berou za husté už 3 m²/m³) a celé porosty nejvýš 4–8 m² listů na m² půdy. Příčiny: každý nový výhon nesl
nejméně čtyři listy, staré pahýly každý rok znovu olistily, list měl i na nejkratším výhonu 72 % plné délky
a stín se počítal jednou ročně v hrubé mřížce jen od listů ležících výš. Ve v10:

1. *Velikost listu podle síly výhonu.* Délka listu = 45–100 % plné délky podle délky výhonu
   (`0,45 + 0,55·(1 − e^(−délka/8 cm))`, dřív 72–100 %); listy druhého rašení jsou ještě o čtvrtinu kratší.
   Odpovídá to kompromisu mezi velikostí a počtem listů (čím víc listů na výhonu, tím jsou úměrně menší)
   i bonsajové praxi (defoliace zmenšuje listy o 50–60 %). Aby neřezané stromy neztratily sílu, má olistění
   ve v10 o 15 % větší účinnost; výška i kmen neřezaných stromů v 10 letech vycházejí do ±7 % jako ve v9.
2. *Krátký výhon nese jediný uzel* (jeden list, u vstřícných druhů jeden pár), ne nejméně dva.
3. *Světlo u listů a letní opad.* Každých 14 dní se listová plocha rozloží do jemné mřížky (2,5 × 1 × 2,5 cm,
   u velkých stromů hrubší) a pro každý výhon se spočítá světlo jako průměr exp(−0,7 × listová plocha podél
   paprsku) přes pět směrů oblohy (Beerův–Lambertův zákon; pro bukové porosty je změřený koeficient 0,68–0,83).
   Listy výhonu, na který dopadá méně než druhový práh (javor 5 %, habr 3 %, buk 2,5 %), během 16 dní
   zežloutnou a opadají. Pod souvislým olistěním to dává strop asi 3,3 m² listů na m² u javoru a 4,1 u buku –
   blízko naměřeným porostům (javor 4,0, buk 4,5–5,1). Zastíněný výhon ten rok nezakládá pupeny, spící pupeny
   mu ale zůstávají: na jaře vyraší, jakmile na něj podle odhadu s plně vyvinutými listy světlo dosáhne
   (po zimním řezu nebo prosvětlení se vnitřek koruny znovu zazelená).
4. *Nástroj Listy* (akce `leaf`): odstranění listů z výhonu, z celé větve, ob list na celém stromě nebo
   z nejvíc zastíněných výhonů (světlo pod 20 %). V době růstu vyraší úžlabní pupeny znovu – krátké výhonky
   s menšími listy; odlistění přidá stres úměrný odstraněnému podílu olistění.

Výsledek ve stejném měření: průměrná délka listu 3,6 → 2,7 cm, v nejhustším místě 6,6 → 3,2 m² listů na m²
půdorysu. Letní opad se u pravidelně zastřihávaného stromu skoro neprojeví (listy jsou menší a pod strop se
vejdou), zasahuje hlavně uvnitř velkých neřezaných korun (u desetiletého javoru v zemi asi čtvrtina výhonů).
Konkrétní práh světla pro opad listu jsme v literatuře nenašli; druhové hodnoty jsou odhad, který dává strop
listové plochy blízký naměřeným porostům. Ani po úpravě není hustota shluků úplně reálná (kolem 40 m²/m³) –
zbytek je daný počtem výhonů.
**Pravidla v11 – pozdní výhony a odložené usychání.** Hlášená chyba: hráč zkrátí jednu větvičku a jiná vedle
uschne. Měření (bonsajový postup, zaštipování koncem června a července; pak zkrácení jednoho koncového výhonu
bez potomků): ve v10 při tom uschlo až 62 cizích výhonů u javoru, 53 u břízy, 49 u dubu, 33 u modřínu, 30 u habru
a 18 u buku. Dvě příčiny: (1) výhon, který vyrostl až po letním zakládání pupenů (druhé rašení po zaštípnutí
nebo odlistění), si nezaložil spící ani vrcholový pupen – přes léto žil díky listům, po opadu byl odsouzený;
(2) odumření se vyhodnocovalo jen při zakládání pupenů, koncem října (před opadem listí) a při každém zásahu,
takže odsouzené výhony „uschly“ až ve chvíli, kdy hráč udělal cokoli jiného. U habru, buku a dubu je navíc do
jara drželo suché listí. Ve v11 si pozdní výhony zakládají pupeny na podzim (při začátku barvení listí: spící
pupeny v úžlabích a vrcholový pupen na 80 % vlastní délky), odumření se vyhodnotí hned po opadu listí a suché
listí výhon naživu nedrží. Ve stejném měření neuschl při řezu žádný cizí výhon u žádného druhu a v žádné roční
době; zaštipování koncem července už nepřipraví strom o větvení (javor: 590 živých výhonů místo 214).

### Ovládání drátu (není verze pravidel – platí pro všechny)

Původní ovládání mířilo směr větve do roviny obrazovky procházející jejím nasazením. Měření (`window.bonsai`,
borovice a javor, 50–60 větví): už při pouhém uchopení, bez pohybu myši, chtělo větev ohnout o medián 47°
(u ostrého zlomu 31°, v 10 % případů přes 88°), protože ji „přicvaklo“ do té roviny; u oblouku se pak směr
k drženému místu lišil od směru ke kurzoru o medián 11°, nejvýš 39°. Výběr navíc bral i pupeny, takže se občas
chytil jiný výhon, než byl zvýrazněný, a ohnutý výhon šel chytit jen na tětivě oblouku, ne tam, kde je vidět.

Nové ovládání je přímá manipulace:

- *Držené místo jde za kurzorem.* Cíl leží v rovině rovnoběžné s obrazovkou, která prochází **drženým bodem**
  (ne nasazením), takže na začátku tažení je ohyb nulový. Oblouk končí přesně v drženém místě: jeho tětiva svírá
  se směrem větve polovinu celkového stočení, proto stačí `stočení = 2 × úhel(směr větve, směr k cíli)` a směr
  od začátku ohybu k drženému místu na obrazovce přesně míří ke kurzoru. Shift při tažení posouvá cíl od kamery
  nebo k ní.
- *Ohyb kdekoli na větvi.* Ohýbá se úsek těsně před drženým místem; jeho délku určuje posuvník (100 % = od kloubu
  až k ruce). Když úsek nezačíná v nasazení ročního přírůstku, výhon se v tom místě rozdělí na dva navazující
  (`splitShoot`): tvar, olistění ani pupeny se nemění, potomci se přepojí. Zásah `wire` má k tomu nepovinné `at`.
  Na jednom ročním přírůstku tak může být víc ohybů za sebou. Už ohnutý oblouk se nedělí – doohýbá se celý.
- *Živý náhled.* Při tažení se strom překresluje ohnutý (u stromů nad 5000 výhonů jen kostra) a pohled se sám
  nepřerámovává. Značka při najetí ukazuje, odkud se větev ohne.

Vlastní kontrola `window.bonsai.wireCheck()` po přepracování: skok na začátku 0 px, odchylka směru 0° (u všech
zkoušených větví, s rozdělením i bez).

Ve v3 se také větev, která převzala vrchol, postupně zvedá ke svislici i ve stávajícím dřevě (tenká rychle,
silná pomalu), a osu může převzít i větev nasazená níž na pahýlu bez jehlic.

**Verze pravidel.** Protože strom je `f(semínko, zásahy, den)`, každá změna modelu růstu mění i už uložené
stromy. Tři z výše uvedených oprav a náhrada vrcholu jsou proto vázané na verzi pravidel uloženou se hrou:
v1 = původní chování, v2 = opravy misek, větvení a náhrady vrcholu, v3 = navíc soběstačnost větví. Hry a stromy ve sbírce uložené před zavedením verzí rostou podle v1
(ověřeno shodou s původním kódem), nová semínka podle nejnovější verze; verzi lze u rozpracovaného stromu přepnout.
Další změny modelu, které mají zachovat staré stromy, patří do nové verze pravidel.

## 3e. Další druhy

Vedle borovice lesní lze zasadit modřín opadavý, habr obecný, buk lesní, dub letní, břízu bělokorou a javor babyku
(`src/sim/species.ts`). Borovice používá původní model beze změny (ověřeno shodou s předchozím kódem ve všech
verzích pravidel); ostatní druhy sdílejí „olistěný“ model:

- **Pupeny v úžlabí listů podél výhonu**, ne přeslen na vrcholu. Postavení dvouřadé (habr, buk – ploché vějíře větví),
  šroubovité (dub s pupeny natěsnanými u konce výhonu, bříza, modřín) nebo vstřícné (babyka).
- **Listy jen na jednu sezónu.** Každé jaro olistí letorosty i krátké výhony na starším dřevě (u modřínu svazečky jehlic),
  na podzim se listí barví a opadá; u buku, habru a dubu část suchých listů zůstává do jara.
- **Spící pupeny.** Strom žije i bez listí, dokud má živé pupeny. Po řezu z nich obráží – podle druhu ochotně i z holého
  pahýlu (habr, dub, babyka), neochotně (buk, modřín) nebo špatně a s rizikem zaschnutí větvičky (bříza).
- **Druhý růst.** Po zaštípnutí v době růstu vyraší nejvyšší zbylé pupeny za pár týdnů znovu (silně habr, dub, babyka; slabě buk).

| Druh | Rašení (d.d. > 5 °C) | Růst | List (cm) | Snáší stín | Obrážení ze starého dřeva | Zvláštnosti v modelu |
| --- | --- | --- | --- | --- | --- | --- |
| Modřín | 45 (konec března–duben) | volný, do srpna | jehlice 2,6; svazečky na krátkých výhonech až 15 let | ne | slabé | špatně snáší zásah do kořenů (stres ×1,5) |
| Habr | 115 (polovina dubna) | delší, ochotný druhý růst | 7 × 3,6 | velmi | silné | suché listí přes zimu; drát zarůstá dřív |
| Buk | 175 (konec dubna–květen) | jedna rychlá vlna | 8 × 5 | nejvíc | slabé | suché listí přes zimu; krátké výhony 8 let; drát zarůstá nejdřív |
| Dub | 200 (květen) | jedna vlna + jánské výhony | 10 × 5,5 laločnatý | středně | silné | klíčí podzemně; hrubá borka od ~12 let |
| Bříza | 70 (začátek dubna) | volný, celé léto; nejrychlejší | 5 × 3,9 | ne | špatné | řezaná větvička zasychá (22 %, mimo olistění 66 %); větve převisají; bílá kůra od ~7 let |
| Babyka | 120 | delší, druhý růst | 6 × 6 dlanitý | středně | silné | vstřícné pupeny; nejlépe snáší přesazení (stres ×0,7) |

Zdroje (z obou rešerší se podařilo získat jen úryvky a údaje z paměti, žádná stránka nebyla přečtena celá):
JRC European Atlas of Forest Tree Species; EUFORGEN; LWF Wissen 69 (modřín), 77 (babyka), 86 (buk); Niinemets & Valladares 2006
(snášení stínu); Gymnosperm Database (*Larix decidua*); druhové průvodce bonsai4me (Harry Harrington) pro *Carpinus*, *Fagus*,
*Quercus*, *Betula*, *Larix*, *Acer campestre*. Číselné hodnoty modelu (účinnost růstu, podíly, pravděpodobnosti) jsou odhady
zkalibrované tak, aby výška ve volné půdě v 10 letech vyšla 2–4,5 m; skutečné stromy rostou zhruba o třetinu až polovinu rychleji.

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
| Jin a shari | Práce s mrtvým dřevem |
| Další druhy | Stálezelené jehličnany (smrk, jalovec) potřebují třetí model: jehlice podél výhonu držící více let |
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
