# Bonsai Simulator

Simulátor růstu bonsaje. První verze: **jeden strom, jeden druh – borovice lesní (*Pinus sylvestris*) ze semínka**.
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

## Ovládání

- **Najetí myší** na výhon nebo pupen ukáže, co zásah udělá; **kliknutí** ho provede. Na dotykovém displeji ťuknutí vybere a tlačítko *Provést* potvrdí.
- **Nástroj Drát:** posuvník *Tvar ohybu* volí ostrý zlom nebo plynulý oblouk; tažením za větev ji ohnete (zelený náhled = bezpečné, červený = hrozí prasknutí); kliknutí na nadrátovanou větev drát sundá.
- **Přesadit…** otevře volbu nádoby, zakrácení kořenů, otočení a náklonu s živým náhledem.
- Tažení mimo strom otáčí pohled, kolečko přibližuje, pravé tlačítko (nebo Shift + tažení) posouvá.
- Mezerník spouští a zastavuje čas, Ctrl+Z vrací poslední zásah.
- Posuvník času jde i dozadu. Zásah v minulosti přepíše pozdější zásahy v deníku.
