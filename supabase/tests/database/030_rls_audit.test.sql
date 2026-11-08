-- Security audit invariants that complement 000/020/030:
--   * catalog: every client-writable operation has a policy for that command, policies target
--     only `authenticated`, insert/update policies carry WITH CHECK, `true` predicates only on
--     non-sensitive reference data, exact SECURITY DEFINER inventory, anon executes nothing in private;
--   * behaviour: object/history visibility follows reassignment; an executor cannot hand his own
--     task to someone else or move it to another object.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(23);

-- ---------------------------------------------------------------------------------------------
-- Catalog invariants
-- ---------------------------------------------------------------------------------------------

-- Every (table, command) the client role holds a privilege for is covered by a policy for that
-- command (or FOR ALL). Otherwise RLS silently denies, or a later permissive policy is missing.
select is_empty(
  $$ select c.relname::text, op.cmd
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) as op(cmd, polcmd)
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and (has_table_privilege('authenticated', c.oid, op.cmd)
             or (op.cmd <> 'DELETE' and has_any_column_privilege('authenticated', c.oid, op.cmd)))
        and not exists (select 1 from pg_policy p
                         where p.polrelid = c.oid and p.polcmd in (op.polcmd::"char", '*')) $$,
  'every client privilege on a public table is covered by a policy for that command'
);

-- Policies are written for `authenticated` only (never PUBLIC/anon).
select is_empty(
  $$ select c.relname::text, p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polroles <> array['authenticated'::regrole::oid] $$,
  'all public policies target only the authenticated role'
);

-- No restrictive policies are relied upon (all access is granted by permissive policies only).
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not p.polpermissive $$,
  'no restrictive policies in public'
);

-- INSERT and UPDATE policies have WITH CHECK (otherwise a row can be moved out of the caller's scope).
select is_empty(
  $$ select c.relname::text, p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polcmd in ('a', 'w', '*') and p.polwithcheck is null $$,
  'insert/update policies have WITH CHECK'
);

-- `true` predicates only on the non-sensitive transition rules (select).
select set_eq(
  $$ select tablename::text, cmd::text from pg_policies
      where schemaname = 'public' and (qual = 'true' or with_check = 'true') $$,
  $$ values ('task_transitions', 'SELECT') $$,
  'using/with check (true) only on task_transitions SELECT'
);

-- Exact SECURITY DEFINER inventory: all in private, nothing anywhere else outside platform schemas.
select set_eq(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private', 'graphql_public') $$,
  $$ values ('private.current_app_role()'), ('private.handle_new_user()'),
            ('private.handle_app_role_changed()'), ('private.handle_password_changed()'),
            ('private.tasks_validate_assignee()'), ('private.profiles_validate_role_change()'),
            ('private.tasks_write_initial_history()'), ('private.tasks_validate_object()'),
            ('private.change_task_status(uuid,task_status,text)'),
            ('private.delete_task(uuid)'), ('private.delete_object(uuid)'),
            ('private.tasks_broadcast()'), ('private.objects_broadcast()'),
            ('private.tasks_notify()'), ('private.history_notify()'),
            ('private.mark_notifications_read(uuid[])'), ('private.mark_all_notifications_read()') $$,
  'SECURITY DEFINER functions: exactly the reviewed set, all in private'
);

-- Exact EXECUTE matrix for client roles on project functions.
select set_eq(
  $$ select p.oid::regprocedure::text, r.role
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join unnest(array['anon', 'authenticated']) as r(role)
      where n.nspname in ('public', 'private') and has_function_privilege(r.role, p.oid, 'execute') $$,
  $$ values ('private.current_app_role()', 'authenticated'),
            ('private.change_task_status(uuid,task_status,text)', 'authenticated'),
            ('change_task_status(uuid,task_status,text)', 'authenticated'),
            ('private.delete_task(uuid)', 'authenticated'), ('delete_task(uuid)', 'authenticated'),
            ('private.delete_object(uuid)', 'authenticated'), ('delete_object(uuid)', 'authenticated'),
            ('private.mark_notifications_read(uuid[])', 'authenticated'),
            ('mark_notifications_read(uuid[])', 'authenticated'),
            ('private.mark_all_notifications_read()', 'authenticated'),
            ('mark_all_notifications_read()', 'authenticated') $$,
  'EXECUTE for anon/authenticated: exactly the reviewed private helpers and public RPCs, authenticated only'
);

-- Nothing in private is granted to PUBLIC (the implicit grantee every role inherits).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public', 'private') and a.grantee = 0 and a.privilege_type = 'EXECUTE' $$,
  'no project function is executable by PUBLIC'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres). Roles are set before any task references the profiles.
-- ---------------------------------------------------------------------------------------------
select tests.create_user('aud-m-' || gen_random_uuid() || '@example.test') as m_id \gset
select tests.create_user('aud-e1-' || gen_random_uuid() || '@example.test') as e1_id \gset
select tests.create_user('aud-e2-' || gen_random_uuid() || '@example.test') as e2_id \gset
update public.profiles set role = 'manager' where id = :'m_id';
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'m_id', :'e1_id', :'e2_id');
insert into public.objects (name, address) values ('aud-OA', 'a') returning id as oa \gset
insert into public.objects (name, address) values ('aud-OB', 'b') returning id as ob \gset

select tests.authenticate_as(:'m_id');
insert into public.tasks (object_id, title, assignee_id) values (:'oa', 'aud-T1', :'e1_id') returning id as t1 \gset
insert into public.tasks (object_id, title, assignee_id) values (:'ob', 'aud-T2', :'e1_id') returning id as t2 \gset
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------------
-- Executor cannot hand over or move his own task.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as(:'e1_id');
select is_empty(format($$ update public.tasks set assignee_id = %L where id = %L returning id $$, :'e2_id', :'t1'),
  'E1 cannot hand his own task to E2 (0 rows)');
select throws_ok(format($$ update public.tasks set object_id = %L where id = %L $$, :'ob', :'t1'),
  '42501', 'permission denied for table tasks', 'E1 cannot move his own task to another object');
select throws_ok(
  format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'aud-upsert', %L)
            on conflict do nothing $$, :'oa', :'e1_id'),
  '42501', 'new row violates row-level security policy for table "tasks"',
  'E1 cannot create a task even with ON CONFLICT DO NOTHING');
select set_eq(
  $$ select name from public.objects where name like 'aud-O%' $$,
  $$ values ('aud-OA'), ('aud-OB') $$,
  'E1 sees both objects that contain his tasks');
select tests.clear_authentication();
select results_eq(
  format($$ select assignee_id, object_id from public.tasks where id = %L $$, :'t1'),
  format($$ values (%L::uuid, %L::uuid) $$, :'e1_id', :'oa'),
  'T1 assignee and object unchanged after executor attempts');

-- ---------------------------------------------------------------------------------------------
-- Visibility of objects and history follows the reassignment.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t1'), 'E1 takes T1 into work');
select tests.authenticate_as(:'m_id');
select results_eq(
  format($$ update public.tasks set assignee_id = %L where id = %L returning id $$, :'e2_id', :'t1'),
  format($$ values (%L::uuid) $$, :'t1'),
  'manager reassigns T1 (in_progress) from E1 to E2');

select tests.authenticate_as(:'e1_id');
select set_eq($$ select name from public.objects where name like 'aud-O%' $$, $$ values ('aud-OB') $$,
  'E1 no longer sees object OA (his only task there was reassigned)');
select is_empty(format($$ select 1 from public.task_status_history where task_id = %L $$, :'t1'),
  'E1 no longer sees the history of the reassigned task');
select throws_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t1'),
  'P0001', 'task_not_found', 'E1 cannot move the reassigned task');

select tests.authenticate_as(:'e2_id');
select set_eq($$ select name from public.objects where name like 'aud-O%' $$, $$ values ('aud-OA') $$,
  'E2 sees object OA (and only it) after the reassignment');
select is((select count(*)::int from public.task_status_history where task_id = :'t1'), 2,
  'E2 sees the full history of the reassigned task');
-- E1 changed the status of a task E2 now owns, so E2 may see E1 in that history (by design).
select is((select count(*)::int from public.profiles where id = :'e1_id'), 1,
  'E2 sees the profile of the previous assignee who appears in the task history');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t1'),
  'E2 continues the workflow from the current status');
select tests.clear_authentication();

select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.task_status_history
             where task_id = %L order by id $$, :'t1'),
  format($$ values (null::text, 'new', %1$L::uuid), ('new', 'in_progress', %2$L), ('in_progress', 'in_review', %3$L) $$,
         :'m_id', :'e1_id', :'e2_id'),
  'history attributes each change to the real actor across the reassignment');

select * from finish();
rollback;
