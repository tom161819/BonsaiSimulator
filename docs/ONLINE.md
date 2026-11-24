# Online část: účty, sbírka v cloudu, výstava

Hra běží na **GitHub Pages**, data jsou v **Supabase**. Bez Supabase hra funguje dál, jen se stromy ukládají v prohlížeči a výstava se nezobrazí.

## Co hráč dostane

- **Účet** (e-mail + heslo, přezdívka). Ve sbírce i na výstavě je vlevo nahoře panel hráče: jméno, hvězdičky celkem, průměr, počet vystavených stromů. Nepřihlášený hráč tam vidí výzvu k přihlášení / registraci.
- **Sbírka v účtu:** „Přidat do sbírky“ ukládá přihlášenému hráči strom do databáze (záznam zásahů + náhled). Stromy z prohlížeče jde jedním tlačítkem nahrát do účtu.
- **Výstava:** strom ze sbírky jde *Vystavit* (a zase *Stáhnout*). Na obrazovce **Výstava** se stromy prochází šipkami (← →), přihlášení hráči je hodnotí 1–10 hvězdičkami (klik nebo klávesy 1–9, 0 = 10). Vlastní strom hodnotit nejde. Vedle jsou žebříčky **nejlépe hodnocených stromů** a **hráčů s nejvíc hvězdičkami**.
- Vyzkoušet bez serveru: otevřete hru s `?online=demo` – účty i výstava běží jen v paměti stránky, s ukázkovými stromy.

## Zprovoznění (jednou)

1. **Supabase projekt** – na supabase.com vytvořte projekt (region např. Frankfurt).
2. **Databáze** – buď propojte projekt s GitHubem (Project Settings → Integrations → GitHub, adresář `supabase`), pak se migrace ze `supabase/migrations` použijí samy po sloučení do `main`; nebo obsah `supabase/migrations/*.sql` vložte do SQL Editoru a spusťte.
3. **Přihlašování** – Authentication → URL Configuration:
   - *Site URL*: `https://tom161819.github.io/BonsaiSimulator/`
   - *Redirect URLs*: totéž (a později vlastní doména, např. `https://bonsai.example.cz/`)
   - Potvrzování e-mailem (Authentication → Sign In / Providers → Email → *Confirm email*) může zůstat zapnuté; hra hráči řekne, ať klikne na odkaz v e-mailu.
4. **Klíče do GitHubu** – v repozitáři Settings → Secrets and variables → Actions → *Variables*:
   - `SUPABASE_URL` = Project URL (Project Settings → API)
   - `SUPABASE_ANON_KEY` = veřejný klíč *anon* / *publishable*. Je určený pro prohlížeč; data chrání pravidla RLS v migraci. **Nikdy sem nedávejte `service_role` / secret klíč.**
5. **GitHub Pages** – Settings → Pages → Build and deployment → Source: **GitHub Actions**. Workflow `.github/workflows/pages.yml` hru sestaví a nasadí při každém pushi do `main` (nebo ručně v záložce Actions).

## Vlastní doména

Funguje bez úprav kódu: v Settings → Pages nastavte *Custom domain* (a u registrátora záznam CNAME na `tom161819.github.io`), v Supabase přidejte novou adresu do *Site URL* / *Redirect URLs*. Hra si adresu pro odkazy v e-mailech bere z aktuální stránky.

## Jak jsou data chráněná

`supabase/migrations/20261124120000_init.sql`:

| Tabulka | Kdo čte | Kdo zapisuje |
| --- | --- | --- |
| `profiles` (přezdívky) | všichni | hráč svůj profil; vzniká sám při registraci |
| `trees` (sbírka, výstava) | hráč své stromy; vystavené všichni (i nepřihlášení) | jen majitel; strom nejde převést na jiného hráče |
| `ratings` (1–10 ★) | každý jen svá hodnocení | přihlášený hráč, jen cizí vystavený strom, jedno hodnocení na strom |

Součty a průměry pro výstavu a žebříčky počítají funkce `exhibition()`, `top_trees()`, `top_users()` a `user_stats()` – ven pouštějí jen souhrny, ne kdo jak hlasoval.

Zkouška pravidel na dočasném Postgresu (16+): `bash scripts/db/test.sh`.
