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
| `npm run samples` | přepočítá vzorovou sbírku a její portréty (nutné po každé změně modelu růstu; potřebuje Playwright s Chromiem) |

## Ovládání

- **Najetí myší** na výhon nebo pupen ukáže, co zásah udělá; **kliknutí** ho provede. Na dotykovém displeji ťuknutí vybere a tlačítko *Provést* potvrdí.
- **Nástroj Drát:** tažením za větev ji ohnete – držené místo jde za kurzorem a ohne se úsek před ním (jeho délku volí posuvník *Délka ohybu*; zelený náhled = bezpečné, červený = hrozí prasknutí). **Ctrl + klik** na větev položí bod ohybu: další tah ji ohne přesně od něj, takže jedna větev (i už nadrátovaná a ohnutá) jde ohnout na víc místech za sebou; Esc bod zruší. Kliknutí na nadrátovanou větev drát sundá.
- **Přesadit…** otevře výběr z katalogu nádob (kelímek 0,5 l až kontejner 25 l, misky 0,2–12 l, volná půda), zakrácení kořenů, otočení a náklonu s živým náhledem.
- **Přidat do sbírky** uloží strom v dnešním stavu; **Moje sbírka** ukáže uložené stromy na lavici, odkud jde v kterémkoli pokračovat. Sbírka se ukládá v prohlížeči. **Vzorová sbírka** obsahuje pět stromů v různých stylech, které hru „odehrál“ skript `scripts/gardener.ts`; každý jde otevřít a projít po časové ose.
- Tažení mimo strom otáčí pohled, kolečko přibližuje, pravé tlačítko (nebo Shift + tažení) posouvá.
- **Plevel** (pravidla v12): v nádobě občas vyroste pampeliška, tráva, orsej nebo kopřiva a bere kořenům místo (vidět v řádku *Kořeny v nádobě*). Pinzetou ho vytrhnete, tlačítko *Odplevelit* pod Pinzetou odstraní všechen; přesazení také.
- Mezerník spouští a zastavuje čas, Ctrl+Z vrací poslední zásah.
- **Vzhled:** trojice ikon vedle výběru pravidel přepíná *podle systému* / *světlý* / *tmavý*. Volba se pamatuje v prohlížeči; v režimu *podle systému* hra následuje i změnu systému za běhu. Pokud vzhled nastaví hostitelská stránka (atribut `data-theme` na `<html>`), má její volba přednost.
- **Nápověda ovládání vlevo dole** ukazuje klávesy a tlačítka myši zvoleného nástroje; Ctrl a Shift se v ní zamáčknou, když je držíte, a odpovídající řádek se zvýrazní. Klávesy **1–4** přepínají nástroje (Nůžky, Pinzeta, Listy, Drát). Panel jde sbalit a podle volného místa se sám zmenšuje (na dotykových zařízeních a v nejmenších oknech se skryje).
- Posuvník času jde i dozadu. Zásah v minulosti přepíše pozdější zásahy v deníku.
