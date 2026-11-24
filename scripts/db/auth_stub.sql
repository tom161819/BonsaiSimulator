-- Zástupné prostředí Supabase pro zkoušku migrací na obyčejném Postgresu (scripts/db/test.sh):
-- role anon/authenticated, schéma auth s tabulkou users a funkcí auth.uid() čtoucí „přihlášeného“ hráče
-- z nastavení request.jwt.claim.sub, a výchozí oprávnění jako v projektu Supabase.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
