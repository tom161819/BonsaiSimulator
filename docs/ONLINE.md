# Online část: účty, sbírka v cloudu, výstava

Hra běží na **GitHub Pages**, data jsou v **Supabase**. Bez Supabase hra funguje dál, jen se stromy ukládají v prohlížeči a výstava se nezobrazí.

## Co hráč dostane

- **Účet** (e-mail + heslo, přezdívka). Ve sbírce i na výstavě je vlevo nahoře panel hráče: jméno, hvězdičky celkem, průměr, počet vystavených stromů. Nepřihlášený hráč tam vidí výzvu k přihlášení / registraci.
- **Sbírka v účtu:** „Přidat do sbírky“ ukládá přihlášenému hráči strom do databáze (záznam zásahů + náhled). Stromy z prohlížeče jde jedním tlačítkem nahrát do účtu.
- **Výstava:** strom ze sbírky jde *Vystavit* (a zase *Stáhnout*). Na obrazovce **Výstava** se stromy prochází šipkami (← →), přihlášení hráči je hodnotí 1–10 hvězdičkami (klik nebo klávesy 1–9, 0 = 10). Vlastní strom hodnotit nejde. Vedle jsou žebříčky **nejlépe hodnocených stromů** a **hráčů s nejvíc hvězdičkami**.
- **Výstavu si prohlédne každý** (i nepřihlášený – tlačítko *Výstava* v horní liště i v panelu hráče); hodnotit mohou jen přihlášení.
- Hra po startu ověří, že je server dosažitelný (stránka vložená jinam, např. na claude.ai, ho může mít zakázaný); když není, běží bez online části a stromy ukládá v prohlížeči.
- Vyzkoušet bez serveru: otevřete hru s `?online=demo` – účty i výstava běží jen v paměti stránky, s ukázkovými stromy.

## Společná databáze s aplikací Bonsai deník

Hra používá **stejný projekt Supabase jako aplikace Bonsai deník** (`tom161819/Bonsai-APP`, projekt `uhyhjpinxsjqfrzgqauu`, nastavený v `online.config.json`). Účty jsou proto společné: **jedna registrace platí pro aplikaci i hru**.

- Tabulky hry mají předponu `game_` (`game_trees`, `game_ratings`) a s tabulkami aplikace (`trees`, `photos`, `care_log`, `tasks`) se nepletou; migrace z aplikace nic nemění.
- Tabulka `profiles` (přezdívka) je společná – aplikace ji může také zobrazovat. Účty založené dřív v aplikaci dostanou přezdívku podle e-mailu a ve hře si ji změní (tlačítko *Změnit* v panelu hráče).
- **Sdílené přihlášení:** obě služby na GitHub Pages běží na stejné adrese `tom161819.github.io` a ukládají přihlášení pod stejným klíčem (`sb-uhyhjpinxsjqfrzgqauu-auth-token`). Kdo se přihlásí v aplikaci, je přihlášený i ve hře (a naopak), stačí obnovit stránku.

## Zprovoznění (jednou)

1. **Databáze hry** – v Supabase (projekt aplikace) otevřete SQL Editor, vložte celý obsah `supabase/migrations/20261124120000_init.sql` a spusťte. (Pokud projekt propojíte s GitHubem přes Project Settings → Integrations, použije se migrace ze složky `supabase/migrations` sama.)
2. **Adresa hry pro přihlašování** – Authentication → URL Configuration → *Redirect URLs*: přidejte `https://tom161819.github.io/BonsaiSimulator/` (adresu aplikace tam nechte). Bez toho by odkazy z e-mailů (potvrzení účtu, nové heslo) vedly do aplikace.
3. **GitHub Pages** – v repozitáři hry Settings → Pages → Build and deployment → Source: **GitHub Actions**. Workflow `.github/workflows/pages.yml` hru sestaví a nasadí při každém pushi do `main` (nebo ručně v záložce Actions). Hra pak běží na `https://tom161819.github.io/BonsaiSimulator/`.

Jiný projekt Supabase jde nastavit proměnnými `SUPABASE_URL` a `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables) – vždy jen veřejný klíč *anon* / *publishable*, **nikdy secret / service_role**.

## Vlastní doména

Funguje bez úprav kódu: v Settings → Pages nastavte *Custom domain* (a u registrátora záznam CNAME na `tom161819.github.io`), v Supabase přidejte novou adresu do *Redirect URLs*. Hra si adresu pro odkazy v e-mailech bere z aktuální stránky.

Aby **přihlášení zůstalo sdílené**, musí být aplikace i hra na stejné adrese (doméně), např. `bonsai.cz` pro aplikaci a `bonsai.cz/hra/` pro hru. Na dvou různých doménách bude účet pořád jeden, jen se v každé službě přihlásíte zvlášť.

## Jak jsou data chráněná

`supabase/migrations/20261124120000_init.sql`:

| Tabulka | Kdo čte | Kdo zapisuje |
| --- | --- | --- |
| `profiles` (přezdívky, společné s aplikací) | všichni | hráč svůj profil; vzniká sám při registraci, dřívějším účtům se doplní |
| `game_trees` (sbírka, výstava) | hráč své stromy; vystavené všichni (i nepřihlášení) | jen majitel; strom nejde převést na jiného hráče |
| `game_ratings` (1–10 ★) | každý jen svá hodnocení (nepřihlášený žádná) | přihlášený hráč, jen cizí vystavený strom, jedno hodnocení na strom |

Součty a průměry pro výstavu a žebříčky počítají funkce `game_exhibition()`, `game_top_trees()`, `game_top_users()` a `game_user_stats()` – ven pouštějí jen souhrny, ne kdo jak hlasoval.

Zkouška pravidel na dočasném Postgresu (16+) vedle tabulek aplikace: `bash scripts/db/test.sh`.
