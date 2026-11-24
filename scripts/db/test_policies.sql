-- Zkouška pravidel přístupu a funkcí výstavy (spouští scripts/db/test.sh po migracích).
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

-- pomůcka: příkaz musí selhat (porušení pravidla RLS nebo kontroly)
create function pg_temp.must_fail(cmd text, why text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    return;
  end;
  raise exception 'MĚLO SELHAT: % (%)', why, cmd;
end $$;
create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  if uid is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

-- tři hráči se zaregistrují (trigger jim založí profil); Bob si zvolí jméno, které už Alice má
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@x', '{"username": "Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@x', '{"username": "alice"}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@x', '{"username": "<Cyril>"}');
do $$ begin
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice', 'profil Alice';
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'alice-1', 'shodné jméno dostane číslo';
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-00000000000c') = 'Cyril', 'zakázané znaky ze jména zmizí';
end $$;

-- dřívější uživatel aplikace dostal profil podle e-mailu; tabulka aplikace zůstala beze změny
do $$ begin
  assert (select username from public.profiles where id = '00000000-0000-0000-0000-0000000000d0') = 'pepa', 'profil pro dřívější účet aplikace';
  assert (select count(*) from public.trees) = 1, 'tabulka trees aplikace je netknutá';
end $$;

-- Alice uloží dva stromy, jeden vystaví
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.game_trees (id, name, species, seed, rules, day, actions, thumb, height)
values ('10000000-0000-0000-0000-000000000001', 'Moje borovice', 'pine', 3, 12, 3000, '[{"day":300,"type":"repot"}]', 'data:image/webp;base64,AAAA', 40),
       ('10000000-0000-0000-0000-000000000002', 'Soukromý habr', 'hornbeam', 4, 12, 2000, '[]', null, 30);
update public.game_trees set exhibited_at = now() where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.must_fail($$insert into public.game_trees (owner, name, seed, day) values ('00000000-0000-0000-0000-00000000000b', 'Podvrh', 1, 1)$$, 'strom za jiného hráče');
select pg_temp.must_fail($$insert into public.game_trees (name, seed, day, thumb) values ('x', 1, 1, 'javascript:alert(1)')$$, 'náhled musí být obrázek');
select pg_temp.must_fail($$insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000001', 10)$$, 'hodnotit vlastní strom');
-- převod stromu na jiného hráče se tiše ignoruje
update public.game_trees set owner = '00000000-0000-0000-0000-00000000000b' where id = '10000000-0000-0000-0000-000000000002';
do $$ begin assert (select owner from public.game_trees where id = '10000000-0000-0000-0000-000000000002') = '00000000-0000-0000-0000-00000000000a', 'majitel se nezmění'; end $$;

-- přezdívka: obsazenou nejde vzít, volnou ano
select pg_temp.must_fail($$update public.profiles set username = 'ALICE-1' where id = '00000000-0000-0000-0000-00000000000a'$$, 'přezdívka obsazená jiným hráčem (bez ohledu na velikost písmen)');
update public.profiles set username = 'Alenka' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set username = 'Alice' where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set username = 'Zloděj' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin assert (select username from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'alice-1', 'cizí profil nejde přejmenovat'; end $$;
-- Alice nevidí deník Pepy v aplikaci
do $$ begin assert (select count(*) from public.trees) = 0, 'stromy aplikace jsou dál soukromé'; end $$;

-- Bob vidí jen vystavený strom Alice, hodnotí ho; nevystavený hodnotit ani měnit nemůže
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$ begin assert (select count(*) from public.game_trees) = 1, 'Bob vidí jen vystavený strom'; end $$;
insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000001', 7);
update public.game_ratings set stars = 9 where tree_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.must_fail($$insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000002', 5)$$, 'hodnotit nevystavený strom');
select pg_temp.must_fail($$insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000001', 11)$$, 'víc než 10 hvězdiček');
select pg_temp.must_fail($$insert into public.game_ratings (tree_id, rater, stars) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 3)$$, 'hodnocení za jiného');
update public.game_trees set name = 'Ukradeno' where id = '10000000-0000-0000-0000-000000000001';
delete from public.game_trees where id = '10000000-0000-0000-0000-000000000001';
do $$ begin assert (select name from public.game_trees where id = '10000000-0000-0000-0000-000000000001') = 'Moje borovice', 'cizí strom nejde změnit ani smazat'; end $$;
-- Bob vystaví svůj strom
insert into public.game_trees (id, name, seed, day, exhibited_at) values ('20000000-0000-0000-0000-000000000001', 'Bobův javor', 9, 1500, now());

-- Cyril hodnotí oba vystavené stromy; hodnocení Boba nevidí
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000001', 4), ('20000000-0000-0000-0000-000000000001', 8);
do $$ begin assert (select count(*) from public.game_ratings) = 2, 'Cyril vidí jen svá hodnocení'; end $$;

-- nepřihlášený návštěvník: vidí výstavu, žebříčky a vystavené stromy, nemůže nic zapsat
select pg_temp.login(null);
do $$ begin
  assert (select count(*) from public.game_trees) = 2, 'nepřihlášený vidí vystavené stromy';
  assert (select count(*) from public.game_exhibition()) = 2, 'výstava má dva stromy';
  assert (select stars from public.game_exhibition() where id = '10000000-0000-0000-0000-000000000001') = 13, 'součet hvězd (9 + 4)';
  assert (select avg_stars from public.game_exhibition() where id = '10000000-0000-0000-0000-000000000001') = 6.5, 'průměr 6,5';
  assert (select name from public.game_top_trees(10) limit 1) = 'Bobův javor', 'nejlepší strom podle průměru (8 > 6,5)';
  assert (select username from public.game_top_users(10) limit 1) = 'Alice', 'nejvíc hvězd má Alice (13 > 8)';
  assert (select exhibited from public.game_user_stats('00000000-0000-0000-0000-00000000000a')) = 1, 'Alice má vystavený jeden strom';
  assert (select trees from public.game_user_stats('00000000-0000-0000-0000-00000000000a')) is null, 'velikost cizí sbírky se neprozradí';
end $$;
select pg_temp.must_fail($$select * from public.game_ratings$$, 'nepřihlášený čte jednotlivá hodnocení');
select pg_temp.must_fail($$insert into public.game_ratings (tree_id, stars) values ('10000000-0000-0000-0000-000000000001', 5)$$, 'nepřihlášený hodnotí');
select pg_temp.must_fail($$insert into public.game_trees (name, seed, day) values ('x', 1, 1)$$, 'nepřihlášený ukládá');

-- Alice stáhne strom z výstavy: zmizí z výstavy, hodnocení zůstanou v jejím součtu
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
do $$ begin assert (select trees from public.game_user_stats('00000000-0000-0000-0000-00000000000a')) = 2, 'majitel vidí velikost své sbírky'; end $$;
update public.game_trees set exhibited_at = null where id = '10000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.game_exhibition()) = 1, 'stažený strom není na výstavě';
  assert (select stars from public.game_user_stats('00000000-0000-0000-0000-00000000000a')) = 13, 'hvězdy zůstanou';
end $$;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.must_fail($$update public.game_ratings set stars = 2 where tree_id = '10000000-0000-0000-0000-000000000001' and stars = 9 returning 1/0$$, 'měnit hodnocení staženého stromu');
-- Bob už stažený strom nevidí
do $$ begin assert (select count(*) from public.game_trees where id = '10000000-0000-0000-0000-000000000001') = 0, 'stažený strom je zase soukromý'; end $$;

reset role;
\o
\echo 'Pravidla přístupu a funkce výstavy: vše prošlo'
