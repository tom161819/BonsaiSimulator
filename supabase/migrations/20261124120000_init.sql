-- Bonsai simulátor (hra): sbírky stromů, výstava a hodnocení – ve stejném projektu Supabase jako aplikace
-- Bonsai deník. Účty (auth.users) jsou společné: jedna registrace platí pro aplikaci i hru.
-- Tabulky hry mají předponu game_, aby se nepletly s tabulkami aplikace (trees, photos, care_log, tasks).
-- Tabulka profiles (přezdívka hráče) je společná a aplikace ji může také používat.
-- Skript jde spustit v SQL Editoru (jednou, celý najednou); nic z aplikace nemění.
-- Strom hry se ukládá jako deterministický záznam (semínko + zásahy + verze pravidel + druh) a náhled.

-- ---------------------------------------------------------------- profily (společné)

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(btrim(username)) between 3 and 24 and username !~ '[<>"\\]'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- volná přezdívka odvozená z návrhu (doplní číslo, když je obsazená)
create or replace function public.free_username(wish text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  base text := left(coalesce(nullif(btrim(regexp_replace(coalesce(wish, ''), '[<>"\\]', '', 'g')), ''), 'hráč'), 20);
  name text;
  n int := 0;
begin
  if char_length(base) < 3 then base := base || '-hráč'; end if;
  name := base;
  while exists (select 1 from public.profiles p where lower(p.username) = lower(name)) loop
    n := n + 1;
    name := base || '-' || n;
  end loop;
  return name;
end $$;

-- profil vznikne s účtem (registrace v aplikaci i ve hře); jméno z metadat username, jinak z e-mailu.
-- Chyba tady nikdy nesmí zablokovat registraci – profil si pak hra založí sama při přihlášení.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.profiles (id, username)
    values (new.id, public.free_username(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'profil pro % nevznikl: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- účty založené dřív (např. v aplikaci) dostanou profil podle e-mailu
insert into public.profiles (id, username)
select u.id, public.free_username(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
order by u.created_at;

-- ---------------------------------------------------------------- stromy hry (sbírka i výstava)

create table public.game_trees (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  species text not null default 'pine' check (char_length(species) between 1 and 20),
  seed bigint not null,
  rules int not null default 1 check (rules between 1 and 1000),
  day int not null check (day >= 0),
  actions jsonb not null default '[]' check (jsonb_typeof(actions) = 'array' and octet_length(actions::text) <= 3000000),
  thumb text check (thumb is null or (thumb like 'data:image/%' and octet_length(thumb) <= 700000)),
  height real not null default 0,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exhibited_at timestamptz -- null = strom není na výstavě
);
create index game_trees_owner_idx on public.game_trees (owner, saved_at desc);
create index game_trees_exhibited_idx on public.game_trees (exhibited_at desc) where exhibited_at is not null;

create function public.game_touch_tree() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.owner := old.owner; -- strom nejde převést na jiného hráče
  return new;
end $$;
create trigger game_trees_touch before update on public.game_trees
  for each row execute function public.game_touch_tree();

-- ---------------------------------------------------------------- hodnocení (1–10 hvězdiček, jedno na hráče a strom)

create table public.game_ratings (
  tree_id uuid not null references public.game_trees (id) on delete cascade,
  rater uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stars smallint not null check (stars between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tree_id, rater)
);
create index game_ratings_rater_idx on public.game_ratings (rater);

create function public.game_touch_rating() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.rater := old.rater;
  new.tree_id := old.tree_id;
  return new;
end $$;
create trigger game_ratings_touch before update on public.game_ratings
  for each row execute function public.game_touch_rating();

-- ---------------------------------------------------------------- pravidla přístupu (RLS) a oprávnění

alter table public.profiles enable row level security;
alter table public.game_trees enable row level security;
alter table public.game_ratings enable row level security;

-- přezdívky jsou veřejné (výstava, žebříčky); hráč si založí a mění jen svůj profil
drop policy if exists "profily vidí všichni" on public.profiles;
drop policy if exists "hráč založí svůj profil" on public.profiles;
drop policy if exists "hráč mění svůj profil" on public.profiles;
create policy "profily vidí všichni" on public.profiles for select using (true);
create policy "hráč založí svůj profil" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "hráč mění svůj profil" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- stromy hry: hráč vidí své; vystavené vidí všichni (i nepřihlášení)
create policy "vlastní a vystavené stromy" on public.game_trees for select
  using (owner = (select auth.uid()) or exhibited_at is not null);
create policy "hráč ukládá své stromy" on public.game_trees for insert to authenticated
  with check (owner = (select auth.uid()));
create policy "hráč mění své stromy" on public.game_trees for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "hráč maže své stromy" on public.game_trees for delete to authenticated
  using (owner = (select auth.uid()));

-- hodnocení: jednotlivé hvězdičky vidí jen ten, kdo je dal (ven jdou jen součty z funkcí níže);
-- hodnotit jde jen cizí strom, který je na výstavě
create policy "hráč vidí svá hodnocení" on public.game_ratings for select to authenticated
  using (rater = (select auth.uid()));
create policy "hráč hodnotí cizí vystavený strom" on public.game_ratings for insert to authenticated
  with check (
    rater = (select auth.uid())
    and exists (select 1 from public.game_trees t where t.id = tree_id and t.exhibited_at is not null and t.owner <> (select auth.uid()))
  );
create policy "hráč mění své hodnocení" on public.game_ratings for update to authenticated
  using (rater = (select auth.uid()))
  with check (
    rater = (select auth.uid())
    and exists (select 1 from public.game_trees t where t.id = tree_id and t.exhibited_at is not null and t.owner <> (select auth.uid()))
  );
create policy "hráč maže své hodnocení" on public.game_ratings for delete to authenticated
  using (rater = (select auth.uid()));

-- oprávnění výslovně (projekt nemusí mít výchozí oprávnění pro nové tabulky); řádky dál hlídá RLS
grant select on public.profiles, public.game_trees to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.game_trees to authenticated;
grant select, insert, update, delete on public.game_ratings to authenticated;

-- ---------------------------------------------------------------- výstava a žebříčky (jen součty, bez jednotlivých hlasů)

-- stromy na výstavě, nejnovější první; náhled a zásahy si hra načte zvlášť z tabulky game_trees
create function public.game_exhibition()
returns table (id uuid, owner uuid, username text, name text, species text, height real, day int, rules int,
               exhibited_at timestamptz, votes int, stars int, avg_stars numeric)
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.username, t.name, t.species, t.height, t.day, t.rules, t.exhibited_at,
         count(r.stars)::int, coalesce(sum(r.stars), 0)::int, round(avg(r.stars), 2)
  from public.game_trees t
  join public.profiles p on p.id = t.owner
  left join public.game_ratings r on r.tree_id = t.id
  where t.exhibited_at is not null
  group by t.id, p.username
  order by t.exhibited_at desc;
$$;

-- nejlépe hodnocené stromy: průměr, při shodě víc hlasů; strom musí mít aspoň min_votes hodnocení
create function public.game_top_trees(lim int default 10, min_votes int default 1)
returns table (id uuid, owner uuid, username text, name text, species text, votes int, stars int, avg_stars numeric)
language sql stable security definer set search_path = '' as $$
  select t.id, t.owner, p.username, t.name, t.species, count(r.stars)::int, sum(r.stars)::int, round(avg(r.stars), 2)
  from public.game_trees t
  join public.profiles p on p.id = t.owner
  join public.game_ratings r on r.tree_id = t.id
  where t.exhibited_at is not null
  group by t.id, p.username
  having count(r.stars) >= greatest(1, min_votes)
  order by avg(r.stars) desc, count(r.stars) desc, t.exhibited_at
  limit least(greatest(lim, 1), 100);
$$;

-- hráči s nejvíc hvězdičkami (součet za všechna hodnocení jejich stromů)
create function public.game_top_users(lim int default 10)
returns table (id uuid, username text, stars int, votes int, avg_stars numeric, exhibited int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username,
         coalesce(sum(r.stars), 0)::int, count(r.stars)::int, round(avg(r.stars), 2),
         (select count(*) from public.game_trees x where x.owner = p.id and x.exhibited_at is not null)::int
  from public.profiles p
  join public.game_trees t on t.owner = p.id
  join public.game_ratings r on r.tree_id = t.id
  group by p.id
  order by sum(r.stars) desc, avg(r.stars) desc, p.username
  limit least(greatest(lim, 1), 100);
$$;

-- souhrn hráče pod jeho jménem: hvězdičky celkem, průměr, počet vystavených stromů
create function public.game_user_stats(uid uuid)
returns table (username text, stars int, votes int, avg_stars numeric, exhibited int, trees int)
language sql stable security definer set search_path = '' as $$
  select p.username,
         coalesce((select sum(r.stars) from public.game_ratings r join public.game_trees t on t.id = r.tree_id where t.owner = p.id), 0)::int,
         (select count(*) from public.game_ratings r join public.game_trees t on t.id = r.tree_id where t.owner = p.id)::int,
         (select round(avg(r.stars), 2) from public.game_ratings r join public.game_trees t on t.id = r.tree_id where t.owner = p.id),
         (select count(*) from public.game_trees t where t.owner = p.id and t.exhibited_at is not null)::int,
         -- velikost sbírky jen pro jejího majitele
         case when p.id = (select auth.uid()) then (select count(*) from public.game_trees t where t.owner = p.id)::int end
  from public.profiles p
  where p.id = uid;
$$;

revoke all on function public.game_exhibition(), public.game_top_trees(int, int), public.game_top_users(int), public.game_user_stats(uuid) from public;
grant execute on function public.game_exhibition(), public.game_top_trees(int, int), public.game_top_users(int), public.game_user_stats(uuid) to anon, authenticated;
revoke all on function public.handle_new_user(), public.free_username(text), public.game_touch_tree(), public.game_touch_rating() from public, anon, authenticated;

notify pgrst, 'reload schema';
