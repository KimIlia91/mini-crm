-- Security baseline (infrastructure only, no CRM business objects).
--
-- `private` holds SECURITY DEFINER helpers and internal tables. It is NOT listed in
-- [api].schemas, so the Data API never exposes it.
-- Policy: `authenticated` has USAGE on the schema (RLS policies are evaluated with the caller's
-- privileges and must be able to call helpers such as private.is_member()), but NOTHING inside
-- it is accessible without an explicit, reviewed grant:
--   grant execute on function private.fn(args) to authenticated;
-- `anon` gets no access at all.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default (pg_default_acl for
-- role postgres). Revoke it, so every RPC must be granted explicitly and consciously:
--   grant execute on function public.fn(args) to authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;
-- PostgreSQL's built-in default grants EXECUTE to PUBLIC (inherited by anon/authenticated); a
-- schema-level revoke cannot remove a built-in/global default, so revoke it globally for postgres.
alter default privileges for role postgres revoke execute on functions from public;

-- Internal tables in `private` are never readable or writable by client roles by default.
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated;
