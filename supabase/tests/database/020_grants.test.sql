-- Exact privilege matrix for client roles on the CRM tables.
-- Every table/column privilege that `anon` or `authenticated` holds in `public` is listed here;
-- anything not listed must be absent. Adding a grant requires updating this file consciously.
begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---------------------------------------------------------------------------------------------
-- Exact table-level matrix (all relations in public, all table privilege types).
-- ---------------------------------------------------------------------------------------------
select set_eq(
  $$ select c.relname::text, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege('authenticated', c.oid, p.priv) $$,
  $$ values ('profiles', 'SELECT'),
            ('objects', 'SELECT'),
            ('tasks', 'SELECT'),
            ('task_status_history', 'SELECT'),
            ('task_transitions', 'SELECT'),
            ('notifications', 'SELECT') $$,
  'authenticated: exact table-level privileges in public (insert/update only per column, no DELETE)'
);

select is_empty(
  $$ select c.relname::text, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege('anon', c.oid, p.priv) $$,
  'anon: no table-level privileges in public'
);

-- ---------------------------------------------------------------------------------------------
-- Exact column-level matrix for writes (SELECT is covered by the table-level grant above).
-- has_column_privilege is true for table-level OR column-level grants, so this is complete.
-- ---------------------------------------------------------------------------------------------
select set_eq(
  $$ select c.relname::text, a.attname::text, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['INSERT', 'UPDATE', 'REFERENCES']) as p(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_column_privilege('authenticated', c.oid, a.attnum, p.priv) $$,
  $$ values ('objects', 'name', 'INSERT'), ('objects', 'address', 'INSERT'),
            ('objects', 'name', 'UPDATE'), ('objects', 'address', 'UPDATE'),
            ('tasks', 'object_id', 'INSERT'), ('tasks', 'title', 'INSERT'),
            ('tasks', 'description', 'INSERT'), ('tasks', 'assignee_id', 'INSERT'),
            ('tasks', 'title', 'UPDATE'), ('tasks', 'description', 'UPDATE'),
            ('tasks', 'assignee_id', 'UPDATE') $$,
  'authenticated: exact column-level INSERT/UPDATE/REFERENCES privileges in public'
);

select is_empty(
  $$ select c.relname::text, a.attname::text, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_column_privilege('anon', c.oid, a.attnum, p.priv) $$,
  'anon: no column-level privileges in public'
);

-- Nothing is granted to PUBLIC (which every role inherits) on public relations.
select is_empty(
  $$ select c.relname::text, a.privilege_type
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
      where n.nspname = 'public' and a.grantee = 0 $$,
  'no privileges granted to PUBLIC on relations in public'
);

-- Sequences (identity of task_status_history.id) are not usable by client roles.
select is_empty(
  $$ select c.relname::text, r.role, p.priv
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join unnest(array['anon', 'authenticated']) as r(role)
      cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(priv)
      where n.nspname = 'public' and c.relkind = 'S'
        and has_sequence_privilege(r.role, c.oid, p.priv) $$,
  'anon/authenticated have no sequence privileges in public'
);

-- ---------------------------------------------------------------------------------------------
-- Readable spot checks for the security-relevant columns (documentation of intent).
-- ---------------------------------------------------------------------------------------------
-- tasks: server-controlled columns are never writable by the client.
select ok(not has_column_privilege('authenticated', 'public.tasks', 'status', 'INSERT'), 'tasks.status not insertable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'status', 'UPDATE'), 'tasks.status not updatable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'author_id', 'INSERT'), 'tasks.author_id not insertable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'author_id', 'UPDATE'), 'tasks.author_id not updatable');
select ok(has_column_privilege('authenticated', 'public.tasks', 'object_id', 'INSERT'), 'tasks.object_id insertable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'object_id', 'UPDATE'), 'tasks.object_id not updatable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'created_at', 'INSERT'), 'tasks.created_at not insertable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'created_at', 'UPDATE'), 'tasks.created_at not updatable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'id', 'INSERT'), 'tasks.id not insertable');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'id', 'UPDATE'), 'tasks.id not updatable');

-- objects: id/created_at are server-controlled.
select ok(not has_column_privilege('authenticated', 'public.objects', 'id', 'INSERT'), 'objects.id not insertable');
select ok(not has_column_privilege('authenticated', 'public.objects', 'created_at', 'UPDATE'), 'objects.created_at not updatable');

-- Soft delete: only the delete RPCs set deleted_at/deleted_by; clients cannot DELETE rows.
select ok(not has_column_privilege('authenticated', 'public.tasks', 'deleted_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.tasks', 'deleted_at', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.tasks', 'deleted_by', 'INSERT')
          and not has_column_privilege('authenticated', 'public.tasks', 'deleted_by', 'UPDATE'),
  'tasks.deleted_at/deleted_by not writable (no client restore or forged deleter)');
select ok(not has_column_privilege('authenticated', 'public.objects', 'deleted_at', 'INSERT')
          and not has_column_privilege('authenticated', 'public.objects', 'deleted_at', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.objects', 'deleted_by', 'INSERT')
          and not has_column_privilege('authenticated', 'public.objects', 'deleted_by', 'UPDATE'),
  'objects.deleted_at/deleted_by not writable (no client restore or forged deleter)');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'DELETE')
          and not has_table_privilege('authenticated', 'public.objects', 'DELETE'),
  'tasks/objects not deletable by the client (soft delete via RPC only)');

-- History is append-only through the transition function / trigger: select only.
select ok(has_table_privilege('authenticated', 'public.task_status_history', 'SELECT'), 'history readable');
select ok(not has_table_privilege('authenticated', 'public.task_status_history', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.task_status_history', 'INSERT'),
  'history not insertable (table or any column)');
select ok(not has_table_privilege('authenticated', 'public.task_status_history', 'UPDATE')
          and not has_any_column_privilege('authenticated', 'public.task_status_history', 'UPDATE'),
  'history not updatable (table or any column)');
select ok(not has_table_privilege('authenticated', 'public.task_status_history', 'DELETE'), 'history not deletable');
select ok(not has_table_privilege('authenticated', 'public.task_status_history', 'TRUNCATE'), 'history not truncatable');

-- Profiles: select only; role cannot be changed by the client.
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'), 'profiles.role not updatable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'INSERT')
          and not has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE')
          and not has_column_privilege('anon', 'public.profiles', 'must_change_password', 'INSERT')
          and not has_column_privilege('anon', 'public.profiles', 'must_change_password', 'UPDATE'),
  'profiles.must_change_password not writable by client roles (cleared only by a password change)');
select ok(not has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.profiles', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'profiles not insertable/updatable/deletable');

-- Transition rules are read-only reference data.
select ok(not has_any_column_privilege('authenticated', 'public.task_transitions', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.task_transitions', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.task_transitions', 'DELETE'),
  'task_transitions read-only');

-- No dangerous table privileges on any CRM table.
select ok(not has_table_privilege('authenticated', 'public.tasks', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.tasks', 'REFERENCES')
          and not has_table_privilege('authenticated', 'public.tasks', 'TRIGGER'),
  'tasks: no TRUNCATE/REFERENCES/TRIGGER');

-- ---------------------------------------------------------------------------------------------
-- Function grants for the transition API.
-- ---------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.change_task_status(uuid, public.task_status, text)', 'execute'),
  'authenticated can execute public.change_task_status');
select ok(not has_function_privilege('anon', 'public.change_task_status(uuid, public.task_status, text)', 'execute'),
  'anon cannot execute public.change_task_status');
select ok(not has_function_privilege('anon', 'private.change_task_status(uuid, public.task_status, text)', 'execute'),
  'anon cannot execute private.change_task_status');
select ok(has_function_privilege('authenticated', 'public.delete_task(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.delete_object(uuid)', 'execute'),
  'authenticated can execute public.delete_task / public.delete_object');
select ok(not has_function_privilege('anon', 'public.delete_task(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.delete_object(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.delete_task(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.delete_object(uuid)', 'execute'),
  'anon cannot execute the delete RPCs (public or private)');
select ok(has_function_privilege('authenticated', 'private.current_app_role()', 'execute'),
  'authenticated can execute private.current_app_role (RLS helper)');
select ok(not has_function_privilege('anon', 'private.current_app_role()', 'execute'),
  'anon cannot execute private.current_app_role');
select ok(not has_schema_privilege('anon', 'public', 'create')
          and not has_schema_privilege('authenticated', 'public', 'create'),
  'client roles cannot create objects in public');

-- ---------------------------------------------------------------------------------------------
-- auth.users drives profile role and the forced-password flag through triggers, so client roles
-- must not be able to write it (raw_app_meta_data, encrypted_password) by any SQL path.
-- ---------------------------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'auth.users', 'INSERT, UPDATE, DELETE, TRUNCATE')
          and not has_table_privilege('authenticated', 'auth.users', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'client roles cannot write auth.users (table level)');
select ok(not has_column_privilege('authenticated', 'auth.users', 'raw_app_meta_data', 'UPDATE')
          and not has_column_privilege('anon', 'auth.users', 'raw_app_meta_data', 'UPDATE'),
  'client roles cannot update auth.users.raw_app_meta_data');
select ok(not has_column_privilege('authenticated', 'auth.users', 'encrypted_password', 'UPDATE')
          and not has_column_privilege('anon', 'auth.users', 'encrypted_password', 'UPDATE'),
  'client roles cannot update auth.users.encrypted_password');
select ok(not has_function_privilege('authenticated', 'private.app_role_from_metadata(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.handle_app_role_changed()', 'execute')
          and not has_function_privilege('authenticated', 'private.handle_password_changed()', 'execute'),
  'authenticated cannot execute role/password sync helpers');

select * from finish();
rollback;
