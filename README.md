# Bonsai Simulator

Simulátor růstu bonsaje ze semínka. Druhy: **borovice lesní, modřín opadavý, habr obecný, buk lesní, dub letní, bříza bělokorá a javor babyka**.
Strom roste den po dni podle fenologie druhu, na časové ose se dá kdykoli zastavit, vrátit a zasáhnout:
zaštípnout svíčku, zkrátit nebo odstranit výhon, vylomit pupen, nadrátovat a ohnout větev,
přesadit se zakrácením kořenů, natočením a náklonem. Každý zásah mění, jak strom poroste dál.

Koncept, architektura a rešerše studií: [docs/KONCEPT.md](docs/KONCEPT.md).

## Spuštění

```bash
npm install
```

```bash
npm run dev
```

Vývojový server běží na http://localhost:5173. `npm run build` vytvoří statickou verzi v `dist/`.

| Příkaz | Co dělá |
| --- | --- |
| `npm test` | testy simulačního jádra (bez grafiky) |
| `npm run calibrate -- 12` | tabulka růstu po letech pro půdu / nádobu / misku |
| `npm run typecheck` | kontrola typů |
| `bash scripts/db/test.sh` | zkouška databázových migrací a pravidel přístupu na dočasném Postgresu |
| `npm run samples` | přepočítá vzorovou sbírku a její portréty (nutné po každé změně modelu růstu; potřebuje Playwright s Chromiem) |

## Online: účty, sbírka v cloudu a výstava

Hra je připravená na GitHub Pages se Supabase – ve stejném projektu jako aplikace Bonsai deník, takže jedna registrace platí pro obě: přihlášení a registrace, sbírka uložená v účtu, **výstava** stromů s hodnocením 1–10 hvězdičkami a žebříčky stromů a hráčů. Zprovoznění, ochrana dat a vlastní doména: [docs/ONLINE.md](docs/ONLINE.md). Bez serveru se stromy ukládají jen v prohlížeči; vyzkoušet online část bez serveru jde s `?online=demo`.

## Ovládání

- **Najetí myší** na výhon nebo pupen ukáže, co zásah udělá; **kliknutí** ho provede. Na dotykovém displeji ťuknutí vybere a tlačítko *Provést* potvrdí.
- **Nástroj Drát:** tažením za větev ji ohnete – držené místo jde za kurzorem a ohne se úsek před ním (jeho délku volí posuvník *Délka ohybu*; zelený náhled = bezpečné, červený = hrozí prasknutí). **Ctrl + klik** na větev položí bod ohybu: další tah ji ohne přesně od něj, takže jedna větev (i už nadrátovaná a ohnutá) jde ohnout na víc místech za sebou; Esc bod zruší. Kliknutí na nadrátovanou větev drát sundá.
- **Nástroj Svíčky** (u borovice místo nástroje Listy): zaštipuje jen letošní rostoucí svíčky, větve ani starší dřevo nevybere – když je pod kurzorem větev, nestane se nic. Klik zaštípne svíčku v místě pod kurzorem, **Ctrl + klik** svíčky na celé větvi podle síly (silné na třetinu, střední na polovinu, slabší o čtvrtinu, nejslabší nechá); tlačítka v panelu zaštípnou silné svíčky nebo všechny na stromě. Svíčky rostou v dubnu až červnu, mimo tu dobu jsou tlačítka neaktivní.
- **Přesadit…** nabídne volnou půdu, pěstební nádobu (kelímek 0,5 l až kontejner 25 l) nebo bonsajovou misku: u misky se nejdřív volí **objem** (0,2–15 l) a pak **tvar** (13 tvarů – obdélníkové, oválné, mokko, kulaté, čtvercová, kaskádová…; každý se vyrábí v několika objemech). Dál zakrácení kořenů, otočení, náklon, mech a barva glazury. Nabídky nádoby, barvy i mechu ukazují volbu na stromě už při najetí myší (i šipkami), kliknutí ji zvolí; odjetím se náhled vrátí.
- **Přidat do sbírky** uloží strom v dnešním stavu; **Moje sbírka** ukáže uložené stromy na mahagonové lavici před dřevěným plotem (s cedulkou druhu), odkud jde v kterémkoli pokračovat. Sbírka se ukládá v prohlížeči. **Vzorová sbírka** obsahuje pět stromů v různých stylech, které hru „odehrál“ skript `scripts/gardener.ts`; každý jde otevřít a projít po časové ose.
- Tažení mimo strom otáčí pohled, kolečko přibližuje, pravé tlačítko (nebo Shift + tažení) posouvá.
- **Plevel** (pravidla v12): v nádobě občas vyroste pampeliška, tráva, orsej nebo kopřiva a bere kořenům místo (vidět v řádku *Kořeny v nádobě*). Pinzetou ho vytrhnete, tlačítko *Odplevelit* pod Pinzetou odstraní všechen; přesazení také.
- Mezerník spouští a zastavuje čas, Ctrl+Z vrací poslední zásah.
- **Nastavení** (ozubené kolo vedle přepínače vzhledu): velikost rozhraní a textů (80–150 %), kvalita vykreslení (úsporná / vyvážená / vysoká), stín stromu, nápověda ovládání vlevo dole, nůžky a drát na stole; **pozadí** (rozostřená zahrada, fotky čínské zahrady, školky pod stínovkou, zahrady pod sklem a krytého patia, světlé a tmavé studio) a **deska pracovního stolu** (prkna, teak, mahagon, ořech, bambus, staré dřevo, tatami, žula). Najetím myší se volba hned ukáže, kliknutím se uloží v prohlížeči.
- **Vzhled:** trojice ikon vedle výběru pravidel přepíná *podle systému* / *světlý* / *tmavý*. Volba se pamatuje v prohlížeči; v režimu *podle systému* hra následuje i změnu systému za běhu. Pokud vzhled nastaví hostitelská stránka (atribut `data-theme` na `<html>`), má její volba přednost.
- **Nápověda ovládání vlevo dole** ukazuje klávesy a tlačítka myši zvoleného nástroje; Ctrl a Shift se v ní zamáčknou, když je držíte, a odpovídající řádek se zvýrazní. Klávesy **1–4** přepínají nástroje (Nůžky, Pinzeta, Listy – u borovice Svíčky, Drát). Panel jde sbalit a podle volného místa se sám zmenšuje (na dotykových zařízeních a v nejmenších oknech se skryje).
- Posuvník času jde i dozadu. Zásah v minulosti přepíše pozdější zásahy v deníku.
