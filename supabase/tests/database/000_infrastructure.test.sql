-- Infrastructure smoke + security invariants that must hold for every future migration.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(25);

select has_extension('pgtap', 'pgTAP is available');
select has_schema('private', 'private schema exists');

-- Invariant: every table in API-exposed schemas has RLS enabled.
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname in ('public', 'graphql_public')
        and not c.relrowsecurity $$,
  'all tables in exposed schemas have RLS enabled'
);

-- Invariant: views in exposed schemas run with the caller's privileges (RLS applies).
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v'
        and n.nspname in ('public', 'graphql_public')
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'views in exposed schemas use security_invoker'
);

-- Invariant: no materialized views in exposed schemas (they bypass RLS).
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'm' and n.nspname in ('public', 'graphql_public') $$,
  'no materialized views in exposed schemas'
);

-- Invariant: SECURITY DEFINER functions are not placed in exposed schemas.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'graphql_public') $$,
  'no SECURITY DEFINER functions in exposed schemas (use private)'
);

-- Invariant: every SECURITY DEFINER function in private pins search_path.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'private'
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg in ('search_path=', 'search_path=""')) $$,
  'SECURITY DEFINER functions set search_path to empty'
);

-- Allowlists use full signatures (regprocedure text, e.g. 'public.change_status(uuid,text)'), so
-- overloads cannot slip through. Every entry needs a security review.
-- Invariant: anon cannot execute any function in public.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('anon', p.oid, 'execute')
        and p.oid::regprocedure::text <> all (array[]::text[]) $$,
  'anon cannot execute functions in public (explicit allowlist only)'
);

-- Invariant: authenticated executes only allowlisted public RPCs (add the signature when granting).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.oid::regprocedure::text <> all (array[
          'change_task_status(uuid,task_status,text)',
          'delete_task(uuid)',
          'delete_object(uuid)'
        ]::text[]) $$,
  'authenticated executes only allowlisted public RPCs'
);

-- Invariant: anon has no privileges on any table, view or sequence in public.
-- `case when relkind = 'S'` is required: SQL does not guarantee evaluation order of AND, and
-- has_sequence_privilege() raises "is not a sequence" if the planner evaluates it on other rows.
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'))
     union all
     select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update') end $$,
  'anon has no privileges on tables, views or sequences in public'
);

-- Invariant: authenticated never gets TRUNCATE/REFERENCES/TRIGGER or sequence access in public.
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')
     union all
     select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        and case when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, 'usage, select, update') end $$,
  'authenticated has no TRUNCATE/REFERENCES/TRIGGER or sequence privileges in public'
);

-- Default privileges: future tables/sequences in public are not accessible to client roles
-- (the platform default ACL grants ALL to anon/authenticated; every grant must be explicit).
select is_empty(
  $$ select d.defaclobjtype::text || ':' || a.grantee::regrole::text || ':' || a.privilege_type
       from pg_default_acl d, aclexplode(d.defaclacl) a
      where d.defaclrole = 'postgres'::regrole
        and d.defaclnamespace = 'public'::regnamespace
        and d.defaclobjtype in ('r', 'S')
        and a.grantee in ('anon'::regrole, 'authenticated'::regrole) $$,
  'default privileges grant nothing on public tables/sequences to anon/authenticated'
);
select lives_ok($$ create table public.tmp_probe_table (id int) $$, 'can create a public probe table');
select ok(not has_table_privilege('anon', 'public.tmp_probe_table', 'select, insert, update, delete')
          and not has_table_privilege('authenticated', 'public.tmp_probe_table', 'select, insert, update, delete'),
  'new public tables are not accessible to anon/authenticated by default');

-- Default privileges: future functions are not executable by client roles.
select is_empty(
  $$ select d.defaclnamespace::regnamespace::text
       from pg_default_acl d
      where d.defaclrole = 'postgres'::regrole
        and d.defaclobjtype = 'f'
        and d.defaclnamespace in ('public'::regnamespace, 'private'::regnamespace)
        and exists (select 1 from aclexplode(d.defaclacl) a
                     where a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0)
                       and a.privilege_type = 'EXECUTE') $$,
  'default privileges do not grant EXECUTE to public/anon/authenticated'
);

-- Behaviour: a function created now (as a migration would) is not callable by client roles.
select lives_ok($$ create function public.tmp_probe() returns int language sql as 'select 1' $$,
  'can create a probe function');
select ok(not has_function_privilege('anon', 'public.tmp_probe()', 'execute')
          and not has_function_privilege('authenticated', 'public.tmp_probe()', 'execute'),
  'new public functions are not executable by anon/authenticated by default');

-- private: anon has no access; authenticated may resolve helpers (USAGE) but nothing inside the
-- schema is executable/readable without an explicit grant listed in the allowlists below.
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has usage on private (needed by RLS helper calls)');
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.oid::regprocedure::text <> all (array[
          'private.current_app_role()',
          'private.change_task_status(uuid,task_status,text)',
          'private.delete_task(uuid)',
          'private.delete_object(uuid)'
        ]::text[]) $$,
  'authenticated executes no private function unless allowlisted'
);
select is_empty(
  $$ select format('%I.%I', n.nspname, c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and (has_table_privilege('authenticated', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'insert')
          or has_table_privilege('authenticated', c.oid, 'update')
          or has_table_privilege('authenticated', c.oid, 'delete')
          or has_table_privilege('authenticated', c.oid, 'truncate')
          or has_table_privilege('authenticated', c.oid, 'references')
          or has_table_privilege('authenticated', c.oid, 'trigger')
          or case when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, 'usage') end) $$,
  'authenticated has no table privileges in private'
);
-- Behaviour: objects created later in private are not accessible by default.
select lives_ok($$ create table private.tmp_probe (id int); create function private.tmp_fn() returns int language sql as 'select 1' $$,
  'can create private probe objects');
select ok(not has_table_privilege('authenticated', 'private.tmp_probe', 'select')
          and not has_function_privilege('authenticated', 'private.tmp_fn()', 'execute'),
  'new private tables/functions are not accessible to authenticated by default');

-- Auth context helper really switches to the client role and claims.
select tests.authenticate_as(tests.create_user('smoke-' || gen_random_uuid() || '@example.test'));
select is(current_user::text, 'authenticated', 'helper switches to authenticated role');
select isnt(auth.uid(), null, 'auth.uid() resolves from JWT claims');
select tests.clear_authentication();

select * from finish();
rollback;
