-- Row-level security by role, executed as the real `authenticated` role with real JWT claims.
-- Only data created inside this transaction is asserted (no global counts; rolled back at the end).
--
-- Fixture ids (fixed, readable; never used by seeds):
--   managers   M1 10000000-…-0001, M2 10000000-…-0002
--   executors  E1 20000000-…-0001, E2 20000000-…-0002
--   objects    O1 30000000-…-0001 (tasks of E1), O2 30000000-…-0002 (task of E2), O3 30000000-…-0003 (empty)
--   tasks      T1 40000000-…-0001 (O1, E1, new), T2 40000000-…-0002 (O1, E1, accepted),
--              T3 40000000-…-0003 (O2, E2, new)
--   not activated (must_change_password = true): U 50000000-…-0001 (manager),
--              UE 50000000-…-0002 (executor) with task T4 40000000-…-0004 (O2, UE, new)
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(96);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres). Profiles are created by the on_auth_user_created trigger from
-- raw_app_meta_data.app_role.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-m1@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"manager"}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-m2@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"manager"}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-e1@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"executor"}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-e2@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"executor"}', '{}', now(), now()),
  ('50000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fresh-u@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"manager"}', '{}', now(), now()),
  ('50000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fresh-ue@rls.test', '', now(), '{"provider":"email","providers":["email"],"app_role":"executor"}', '{}', now(), now());

-- Activate M1, M2, E1, E2: a real password change clears must_change_password (trigger).
-- U and UE keep the initial state.
update auth.users set encrypted_password = extensions.crypt('x', extensions.gen_salt('bf'))
 where id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
              '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');

insert into public.objects (id, name, address) values
  ('30000000-0000-4000-8000-000000000001', 'rls-O1', 'addr 1'),
  ('30000000-0000-4000-8000-000000000002', 'rls-O2', 'addr 2'),
  ('30000000-0000-4000-8000-000000000003', 'rls-O3', 'addr 3');

-- author_id is explicit here: as postgres there is no auth.uid() for the default.
insert into public.tasks (id, object_id, title, description, assignee_id, author_id) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'rls-T1', '',
   '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'rls-T2', '',
   '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'rls-T3', '',
   '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', 'fresh-T4', '',
   '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select id, role::text, must_change_password from public.profiles
      where id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
                   '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
                   '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002') order by 1 $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid, 'manager', false),
            ('10000000-0000-4000-8000-000000000002'::uuid, 'manager', false),
            ('20000000-0000-4000-8000-000000000001'::uuid, 'executor', false),
            ('20000000-0000-4000-8000-000000000002'::uuid, 'executor', false),
            ('50000000-0000-4000-8000-000000000001'::uuid, 'manager', true),
            ('50000000-0000-4000-8000-000000000002'::uuid, 'executor', true) $$,
  'profiles from app_metadata roles; must_change_password cleared only by a password change'
);

-- T2 → accepted through the real transition API (E1: in_progress, in_review; M1: accepted).
select tests.authenticate_as('20000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.change_task_status('40000000-0000-4000-8000-000000000002', 'in_progress') $$,
  'fixture: E1 takes T2 in progress');
select lives_ok($$ select public.change_task_status('40000000-0000-4000-8000-000000000002', 'in_review') $$,
  'fixture: E1 sends T2 to review');
select tests.authenticate_as('10000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.change_task_status('40000000-0000-4000-8000-000000000002', 'accepted') $$,
  'fixture: M1 accepts T2');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------------
-- Visibility: managers see everything.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('10000000-0000-4000-8000-000000000001');
select results_eq(
  $$ select id from public.objects where name like 'rls-O%' order by 1 $$,
  $$ values ('30000000-0000-4000-8000-000000000001'::uuid), ('30000000-0000-4000-8000-000000000002'::uuid),
            ('30000000-0000-4000-8000-000000000003'::uuid) $$,
  'M1 sees all fixture objects');
select results_eq(
  $$ select id from public.tasks where title like 'rls-T%' order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid), ('40000000-0000-4000-8000-000000000002'::uuid),
            ('40000000-0000-4000-8000-000000000003'::uuid) $$,
  'M1 sees all fixture tasks');
select results_eq(
  $$ select h.task_id, count(*)::int from public.task_status_history h
      where h.task_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
                          '40000000-0000-4000-8000-000000000003')
      group by h.task_id order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid, 1), ('40000000-0000-4000-8000-000000000002'::uuid, 4),
            ('40000000-0000-4000-8000-000000000003'::uuid, 1) $$,
  'M1 sees the full history of all fixture tasks');
select results_eq(
  $$ select id from public.profiles where email like 'rls-%@rls.test' order by 1 $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid), ('10000000-0000-4000-8000-000000000002'::uuid),
            ('20000000-0000-4000-8000-000000000001'::uuid), ('20000000-0000-4000-8000-000000000002'::uuid) $$,
  'M1 sees all fixture profiles');

select tests.authenticate_as('10000000-0000-4000-8000-000000000002');
select results_eq(
  $$ select id from public.objects where name like 'rls-O%' order by 1 $$,
  $$ values ('30000000-0000-4000-8000-000000000001'::uuid), ('30000000-0000-4000-8000-000000000002'::uuid),
            ('30000000-0000-4000-8000-000000000003'::uuid) $$,
  'M2 sees all fixture objects');
select results_eq(
  $$ select id from public.tasks where title like 'rls-T%' order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid), ('40000000-0000-4000-8000-000000000002'::uuid),
            ('40000000-0000-4000-8000-000000000003'::uuid) $$,
  'M2 sees tasks authored by another manager');

-- ---------------------------------------------------------------------------------------------
-- Visibility: executor E1 sees only own tasks, their objects/history, managers and himself.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('20000000-0000-4000-8000-000000000001');
select results_eq(
  $$ select id from public.objects where name like 'rls-O%' order by 1 $$,
  $$ values ('30000000-0000-4000-8000-000000000001'::uuid) $$,
  'E1 sees only objects with his tasks');
select results_eq(
  $$ select id from public.tasks where title like 'rls-T%' order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid), ('40000000-0000-4000-8000-000000000002'::uuid) $$,
  'E1 sees only tasks assigned to him');
select results_eq(
  $$ select h.task_id, count(*)::int from public.task_status_history h
      where h.task_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
                          '40000000-0000-4000-8000-000000000003')
      group by h.task_id order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid, 1), ('40000000-0000-4000-8000-000000000002'::uuid, 4) $$,
  'E1 sees history only of his tasks');
select results_eq(
  $$ select id from public.profiles where email like 'rls-%@rls.test' order by 1 $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid), ('10000000-0000-4000-8000-000000000002'::uuid),
            ('20000000-0000-4000-8000-000000000001'::uuid) $$,
  'E1 sees himself and managers, not E2');
select is((select count(*)::int from public.task_transitions), 5, 'E1 reads the 5 transition rules');

-- ---------------------------------------------------------------------------------------------
-- Visibility: executor E2 is isolated from E1.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('20000000-0000-4000-8000-000000000002');
select results_eq(
  $$ select id from public.objects where name like 'rls-O%' order by 1 $$,
  $$ values ('30000000-0000-4000-8000-000000000002'::uuid) $$,
  'E2 sees only objects with his tasks');
select results_eq(
  $$ select id from public.tasks where title like 'rls-T%' order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000003'::uuid) $$,
  'E2 sees only tasks assigned to him');
select results_eq(
  $$ select h.task_id, count(*)::int from public.task_status_history h
      where h.task_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
                          '40000000-0000-4000-8000-000000000003')
      group by h.task_id order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000003'::uuid, 1) $$,
  'E2 sees history only of his tasks');
select results_eq(
  $$ select id from public.profiles where email like 'rls-%@rls.test' order by 1 $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid), ('10000000-0000-4000-8000-000000000002'::uuid),
            ('20000000-0000-4000-8000-000000000002'::uuid) $$,
  'E2 sees himself and managers, not E1');
select is_empty($$ select 1 from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  'E2 cannot select E1 task by id');
select is_empty($$ select 1 from public.objects where id = '30000000-0000-4000-8000-000000000001' $$,
  'E2 cannot select E1 object by id');
select is_empty($$ select 1 from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000002' $$,
  'E2 cannot read history of E1 task');
select is_empty($$ select 1 from public.profiles where id = '20000000-0000-4000-8000-000000000001' $$,
  'E2 cannot read E1 profile');

-- E2 writes against E1 data: invisible rows are untouched, self-assignment impossible.
select is_empty($$ update public.tasks set title = 'hacked' where id = '40000000-0000-4000-8000-000000000001' returning id $$,
  'E2 update of E1 task affects 0 rows');
select is_empty($$ update public.tasks set assignee_id = '20000000-0000-4000-8000-000000000002'
                    where id = '40000000-0000-4000-8000-000000000001' returning id $$,
  'E2 cannot reassign E1 task to himself (0 rows)');
select throws_ok($$ delete from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'E2 cannot DELETE E1 task (no client DELETE)');
select throws_ok($$ select public.delete_task('40000000-0000-4000-8000-000000000001') $$,
  'P0001', 'task_not_found', 'E2 cannot soft-delete E1 task via RPC (task_not_found)');
select throws_ok(
  $$ insert into public.tasks (object_id, title, assignee_id)
     values ('30000000-0000-4000-8000-000000000002', 'rls-self', '20000000-0000-4000-8000-000000000002') $$,
  '42501', 'new row violates row-level security policy for table "tasks"',
  'E2 cannot create a task assigned to himself');
select throws_ok(
  $$ select public.change_task_status('40000000-0000-4000-8000-000000000001', 'in_progress') $$,
  'P0001', 'task_not_found',
  'E2 cannot change status of E1 task (task_not_found, not an existence oracle)');

-- ---------------------------------------------------------------------------------------------
-- Not activated users (must_change_password = true) get no access, whatever their role.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('50000000-0000-4000-8000-000000000001');
select is_empty($$ select 1 from public.objects where name like 'rls-O%' $$, 'fresh manager U sees no objects');
select is_empty($$ select 1 from public.tasks where title like 'rls-T%' or title like 'fresh-%' $$,
  'fresh manager U sees no tasks');
select is_empty(
  $$ select 1 from public.task_status_history
      where task_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
                        '40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004') $$,
  'fresh manager U sees no history');
select results_eq(
  $$ select id from public.profiles where email like '%@rls.test' $$,
  $$ values ('50000000-0000-4000-8000-000000000001'::uuid) $$,
  'fresh manager U sees only his own profile');
select throws_ok(
  $$ insert into public.objects (name, address) values ('fresh-object', 'x') $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'fresh manager U cannot create objects');
select is_empty($$ update public.tasks set title = 'fresh edit' where id = '40000000-0000-4000-8000-000000000003' returning id $$,
  'fresh manager U cannot edit tasks (0 rows)');
select throws_ok(
  $$ select public.change_task_status('40000000-0000-4000-8000-000000000003', 'in_progress') $$,
  'P0001', null, 'fresh manager U cannot change statuses');
select throws_ok(
  $$ update public.profiles set must_change_password = false where id = '50000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table profiles', 'fresh user cannot clear must_change_password directly');

select tests.authenticate_as('50000000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.tasks where id = '40000000-0000-4000-8000-000000000004' $$,
  'fresh executor UE does not see the task assigned to him');
select is_empty($$ select 1 from public.objects where id = '30000000-0000-4000-8000-000000000002' $$,
  'fresh executor UE does not see the object of his task');
select is_empty($$ select 1 from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000004' $$,
  'fresh executor UE does not see the history of his task');
select throws_ok(
  $$ select public.change_task_status('40000000-0000-4000-8000-000000000004', 'in_progress') $$,
  'P0001', null, 'fresh executor UE cannot take his task in progress');
select tests.clear_authentication();
select results_eq(
  $$ select t.status::text, p.must_change_password
       from public.tasks t join public.profiles p on p.id = t.assignee_id
      where t.id = '40000000-0000-4000-8000-000000000004' $$,
  $$ values ('new'::text, true) $$,
  'T4 unchanged and UE still not activated');

-- ---------------------------------------------------------------------------------------------
-- Executor E1 writes to his own data: everything except the transition API is denied.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('20000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.tasks set status = 'in_progress' where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'E1 cannot update status directly');
select is_empty($$ update public.tasks set title = 'mine now' where id = '40000000-0000-4000-8000-000000000001' returning id $$,
  'E1 update of own task title affects 0 rows');
select throws_ok($$ delete from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'E1 cannot DELETE own task (no client DELETE)');
select throws_ok($$ select public.delete_task('40000000-0000-4000-8000-000000000001') $$,
  'P0001', 'task_not_found', 'E1 cannot soft-delete own task via RPC (task_not_found)');
select throws_ok(
  $$ insert into public.tasks (object_id, title, assignee_id)
     values ('30000000-0000-4000-8000-000000000001', 'rls-e1-insert', '20000000-0000-4000-8000-000000000001') $$,
  '42501', 'new row violates row-level security policy for table "tasks"', 'E1 cannot create tasks');
select throws_ok(
  $$ insert into public.objects (name, address) values ('rls-e1-object', 'x') $$,
  '42501', 'new row violates row-level security policy for table "objects"', 'E1 cannot create objects');
select is_empty($$ update public.objects set name = 'hacked' where id = '30000000-0000-4000-8000-000000000001' returning id $$,
  'E1 update of visible object affects 0 rows');
select throws_ok($$ delete from public.objects where id = '30000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table objects', 'E1 cannot DELETE a visible object (no client DELETE)');
select throws_ok($$ select public.delete_object('30000000-0000-4000-8000-000000000003') $$,
  'P0001', 'object_not_found', 'E1 cannot soft-delete an object via RPC (object_not_found)');
select throws_ok(
  $$ insert into public.task_status_history (task_id, from_status, to_status, changed_by)
     values ('40000000-0000-4000-8000-000000000001', 'new', 'accepted', '10000000-0000-4000-8000-000000000001') $$,
  '42501', 'permission denied for table task_status_history', 'E1 cannot forge history');
select throws_ok(
  $$ update public.task_status_history set comment = 'rewritten' where task_id = '40000000-0000-4000-8000-000000000002' $$,
  '42501', 'permission denied for table task_status_history', 'E1 cannot rewrite history');
select throws_ok(
  $$ delete from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000002' $$,
  '42501', 'permission denied for table task_status_history', 'E1 cannot delete history');
select throws_ok(
  $$ update public.profiles set role = 'manager' where id = '20000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table profiles', 'E1 cannot promote himself to manager');

-- Nothing above changed data (checked as postgres, bypassing RLS).
select tests.clear_authentication();
select results_eq(
  $$ select title, status::text, assignee_id from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  $$ values ('rls-T1', 'new', '20000000-0000-4000-8000-000000000001'::uuid) $$,
  'T1 unchanged after executor attempts');
select results_eq(
  $$ select h.task_id, count(*)::int from public.task_status_history h
      where h.task_id in ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
                          '40000000-0000-4000-8000-000000000003')
      group by h.task_id order by 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid, 1), ('40000000-0000-4000-8000-000000000002'::uuid, 4),
            ('40000000-0000-4000-8000-000000000003'::uuid, 1) $$,
  'history unchanged after executor attempts');
select is((select role::text from public.profiles where id = '20000000-0000-4000-8000-000000000001'), 'executor',
  'E1 role unchanged');

-- ---------------------------------------------------------------------------------------------
-- Manager CRUD and its limits.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as('10000000-0000-4000-8000-000000000001');
select results_eq(
  $$ insert into public.objects (name, address) values ('rls-new-object', 'addr new') returning name $$,
  $$ values ('rls-new-object') $$,
  'M1 creates an object');
select throws_ok(
  $$ insert into public.objects (id, name, address) values (gen_random_uuid(), 'rls-forced-id', 'x') $$,
  '42501', 'permission denied for table objects', 'M1 cannot choose object id');
select results_eq(
  $$ update public.objects set name = 'rls-O1 renamed' where id = '30000000-0000-4000-8000-000000000001' returning id $$,
  $$ values ('30000000-0000-4000-8000-000000000001'::uuid) $$,
  'M1 updates an object');
select throws_ok(
  $$ update public.tasks set status = 'accepted' where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'M1 cannot update status directly');
select throws_ok(
  $$ update public.tasks set author_id = '10000000-0000-4000-8000-000000000002' where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'M1 cannot change author');
select throws_ok(
  $$ update public.tasks set object_id = '30000000-0000-4000-8000-000000000002' where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table tasks', 'M1 cannot move a task to another object');
select is_empty($$ update public.tasks set title = 'edit accepted' where id = '40000000-0000-4000-8000-000000000002' returning id $$,
  'accepted task is not editable by a manager (0 rows)');
select is_empty($$ update public.tasks set assignee_id = '20000000-0000-4000-8000-000000000002'
                    where id = '40000000-0000-4000-8000-000000000002' returning id $$,
  'accepted task cannot be reassigned (0 rows)');
select throws_ok(
  $$ update public.tasks set assignee_id = '10000000-0000-4000-8000-000000000002' where id = '40000000-0000-4000-8000-000000000001' $$,
  'P0001', 'assignee_not_executor', 'M1 cannot assign a manager on update');
select throws_ok(
  $$ insert into public.tasks (object_id, title, assignee_id)
     values ('30000000-0000-4000-8000-000000000001', 'rls-to-manager', '10000000-0000-4000-8000-000000000002') $$,
  'P0001', 'assignee_not_executor', 'M1 cannot assign a manager on insert');
select throws_ok(
  $$ insert into public.tasks (object_id, title, assignee_id, status)
     values ('30000000-0000-4000-8000-000000000001', 'rls-forced-status', '20000000-0000-4000-8000-000000000001', 'accepted') $$,
  '42501', 'permission denied for table tasks', 'insert with explicit status is denied');
select throws_ok(
  $$ insert into public.tasks (object_id, title, assignee_id, author_id)
     values ('30000000-0000-4000-8000-000000000001', 'rls-forged-author', '20000000-0000-4000-8000-000000000001',
             '10000000-0000-4000-8000-000000000002') $$,
  '42501', 'permission denied for table tasks', 'insert with explicit (foreign) author_id is denied');
select throws_ok(
  $$ insert into public.tasks (id, object_id, title, assignee_id)
     values (gen_random_uuid(), '30000000-0000-4000-8000-000000000001', 'rls-forced-id', '20000000-0000-4000-8000-000000000001') $$,
  '42501', 'permission denied for table tasks', 'insert with explicit id is denied');

-- Another manager may edit a task authored by M1.
select tests.authenticate_as('10000000-0000-4000-8000-000000000002');
select results_eq(
  $$ update public.tasks set title = 'rls-T1 edited by M2' where id = '40000000-0000-4000-8000-000000000001' returning id $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid) $$,
  'M2 edits a task authored by M1');

-- Insert: the database sets status='new', author=auth.uid() and writes exactly one history row.
select results_eq(
  $$ insert into public.tasks (object_id, title, assignee_id)
     values ('30000000-0000-4000-8000-000000000001', 'rls-insert-probe', '20000000-0000-4000-8000-000000000001')
     returning status::text, author_id $$,
  $$ values ('new', '10000000-0000-4000-8000-000000000002'::uuid) $$,
  'insert sets status new and author = auth.uid()');
select results_eq(
  $$ select h.from_status::text, h.to_status::text, h.changed_by, h.comment
       from public.task_status_history h join public.tasks t on t.id = h.task_id
      where t.title = 'rls-insert-probe' $$,
  $$ values (null::text, 'new'::text, '10000000-0000-4000-8000-000000000002'::uuid, null::text) $$,
  'insert writes exactly one initial history row');

-- Deletion rules.
select tests.authenticate_as('10000000-0000-4000-8000-000000000001');
select throws_ok($$ delete from public.objects where id = '30000000-0000-4000-8000-000000000003' $$,
  '42501', 'permission denied for table objects', 'M1 cannot DELETE an object directly (soft delete via RPC only)');
select throws_ok($$ delete from public.tasks where id = '40000000-0000-4000-8000-000000000003' $$,
  '42501', 'permission denied for table tasks', 'M1 cannot DELETE a task directly (soft delete via RPC only)');
select throws_ok($$ select public.delete_object('30000000-0000-4000-8000-000000000001') $$,
  'P0001', 'object_has_tasks', 'object with active tasks cannot be deleted');
select lives_ok($$ select public.delete_object('30000000-0000-4000-8000-000000000003') $$,
  'M1 deletes an empty object via RPC');
select is_empty($$ select 1 from public.objects where id = '30000000-0000-4000-8000-000000000003' $$,
  'the deleted object is invisible to M1');

-- Reassignment moves visibility from E1 to E2.
select results_eq(
  $$ update public.tasks set assignee_id = '20000000-0000-4000-8000-000000000002'
      where id = '40000000-0000-4000-8000-000000000001' returning id $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid) $$,
  'M1 reassigns T1 from E1 to E2');
select tests.authenticate_as('20000000-0000-4000-8000-000000000001');
select is_empty($$ select 1 from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  'E1 loses access to the reassigned task');
select tests.authenticate_as('20000000-0000-4000-8000-000000000002');
select results_eq(
  $$ select id from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid) $$,
  'E2 gains access to the reassigned task');

select tests.authenticate_as('10000000-0000-4000-8000-000000000001');
select lives_ok($$ select public.delete_task('40000000-0000-4000-8000-000000000001') $$,
  'M1 deletes a task via RPC');
select is_empty($$ select 1 from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  'the deleted task is invisible to M1');
select is_empty($$ select 1 from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000001' $$,
  'the history of the deleted task is invisible to M1');
select tests.authenticate_as('20000000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  'the deleted task is invisible to its assignee E2');
select is_empty($$ select 1 from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000001' $$,
  'the history of the deleted task is invisible to its assignee E2');
select is_empty($$ select 1 from public.objects where id = '30000000-0000-4000-8000-000000000001' $$,
  'E2 no longer sees O1 (his only task there is deleted)');
select throws_ok($$ select public.change_task_status('40000000-0000-4000-8000-000000000001', 'in_progress') $$,
  'P0001', 'task_not_found', 'E2 cannot change the status of the deleted task');
select tests.clear_authentication();
select results_eq(
  $$ select deleted_by, deleted_at is not null from public.tasks where id = '40000000-0000-4000-8000-000000000001' $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'deleted task row is kept, deleted_by = the calling manager');
select is((select count(*)::int from public.task_status_history where task_id = '40000000-0000-4000-8000-000000000001'), 1,
  'the history of the deleted task is physically kept');

-- ---------------------------------------------------------------------------------------------
-- anon: no access at all.
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_anon();
select throws_ok($$ select 1 from public.objects $$, '42501', 'permission denied for table objects', 'anon cannot read objects');
select throws_ok($$ select 1 from public.tasks $$, '42501', 'permission denied for table tasks', 'anon cannot read tasks');
select throws_ok($$ select 1 from public.task_status_history $$, '42501', 'permission denied for table task_status_history',
  'anon cannot read history');
select throws_ok($$ select 1 from public.profiles $$, '42501', 'permission denied for table profiles', 'anon cannot read profiles');
select throws_ok(
  $$ select public.change_task_status('40000000-0000-4000-8000-000000000003', 'in_progress') $$,
  '42501', 'permission denied for function change_task_status', 'anon cannot call change_task_status');
select tests.clear_authentication();

select * from finish();
rollback;
