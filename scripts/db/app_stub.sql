-- Tabulky aplikace Bonsai deník (tom161819/Bonsai-APP, supabase/schema.sql) ve zkráceném tvaru a její dřívější uživatel:
-- migrace hry se s nimi musí snést ve stejném projektu (jiné názvy tabulek, profil i pro dřívější účty).
create table public.trees (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null
);
alter table public.trees enable row level security;
create policy "own trees" on public.trees for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.trees to authenticated;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d0', 'pepa@example.cz', '{}');
insert into public.trees (id, user_id, name) values ('app-1', '00000000-0000-0000-0000-0000000000d0', 'Pepův jalovec z deníku');
