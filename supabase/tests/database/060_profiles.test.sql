-- Profiles are created by a trigger on auth.users; the role comes only from app_metadata.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(48);

create function pg_temp.new_auth_user(p_email text, p_app jsonb, p_user jsonb default '{}') returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          '', now(), p_app, p_user, now(), now());
  return v_id;
end;
$$;

select has_trigger('auth', 'users', 'on_auth_user_created', 'trigger on_auth_user_created exists');
select has_trigger('auth', 'users', 'on_auth_user_app_role_changed', 'trigger on_auth_user_app_role_changed exists');
select is((select prosecdef from pg_proc where oid = 'private.handle_new_user()'::regprocedure), true,
  'handle_new_user is security definer');

-- app_role = manager / executor / missing
select pg_temp.new_auth_user('p-mgr-' || gen_random_uuid() || '@example.test',
  '{"provider":"email","providers":["email"],"app_role":"manager"}', '{"full_name":"  Anna Manager  "}') as mgr_id \gset
select pg_temp.new_auth_user('p-exec-' || gen_random_uuid() || '@example.test',
  '{"provider":"email","app_role":"executor"}') as exec_id \gset
select pg_temp.new_auth_user('ivan.petrov+' || gen_random_uuid() || '@example.test',
  '{"provider":"email"}') as norole_id \gset

select is((select role::text from public.profiles where id = :'mgr_id'), 'manager', 'app_role manager -> manager');
select is((select role::text from public.profiles where id = :'exec_id'), 'executor', 'app_role executor -> executor');
select is((select role::text from public.profiles where id = :'norole_id'), 'executor', 'missing app_role -> executor');

-- full_name from user_metadata (trimmed) or the email local part; email copied.
select is((select full_name from public.profiles where id = :'mgr_id'), 'Anna Manager', 'full_name from user_metadata');
select ok((select full_name like 'ivan.petrov+%' and position('@' in full_name) = 0
             from public.profiles where id = :'norole_id'), 'full_name falls back to email local part');
select is((select p.email from public.profiles p where p.id = :'mgr_id'),
          (select u.email::text from auth.users u where u.id = :'mgr_id'), 'email copied from auth.users');
select ok((select created_at is not null from public.profiles where id = :'mgr_id'), 'created_at set');

-- user_metadata cannot grant a role.
select pg_temp.new_auth_user('p-um-' || gen_random_uuid() || '@example.test',
  '{"provider":"email"}', '{"app_role":"manager","role":"manager"}') as um_id \gset
select is((select role::text from public.profiles where id = :'um_id'), 'executor',
  'app_role in user_metadata is ignored');

-- Invalid app_role aborts user creation.
select throws_ok($$ select pg_temp.new_auth_user('p-bad-' || gen_random_uuid() || '@example.test',
  '{"app_role":"admin"}') $$, '22023', 'invalid_app_role', 'invalid app_role rejected');
select throws_ok($$ select pg_temp.new_auth_user('p-empty-' || gen_random_uuid() || '@example.test',
  '{"app_role":""}') $$, '22023', 'invalid_app_role', 'empty app_role rejected');

-- The Auth admin API inserts the user first and writes app_metadata in a following UPDATE
-- (same transaction), so the role is also synced when app_metadata.app_role changes.
select pg_temp.new_auth_user('p-admin-' || gen_random_uuid() || '@example.test',
  '{"provider":"email","providers":["email"]}') as admin_created_id \gset
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"app_role":"manager"}'
 where id = :'admin_created_id';
select is((select role::text from public.profiles where id = :'admin_created_id'), 'manager',
  'app_role written after insert (admin API flow) sets the role');
update auth.users set raw_app_meta_data = raw_app_meta_data - 'app_role' where id = :'admin_created_id';
select is((select role::text from public.profiles where id = :'admin_created_id'), 'executor',
  'removing app_role falls back to executor');
select throws_ok(format($$ update auth.users set raw_app_meta_data = raw_app_meta_data || '{"app_role":"root"}'
  where id = %L $$, :'admin_created_id'), '22023', 'invalid_app_role', 'invalid app_role on update rejected');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"provider":"email"}', email_confirmed_at = now()
 where id = :'mgr_id';
select is((select role::text from public.profiles where id = :'mgr_id'), 'manager',
  'unrelated app_metadata/user updates keep the role');

-- full_name: any ASCII whitespace is trimmed; whitespace-only falls back to the email local part.
select pg_temp.new_auth_user('ws.only+' || gen_random_uuid() || '@example.test',
  '{"provider":"email"}', jsonb_build_object('full_name', E'\t\n')) as ws_id \gset
select ok((select full_name like 'ws.only+%' from public.profiles where id = :'ws_id'),
  'tab/newline-only full_name falls back to email local part');
select pg_temp.new_auth_user('p-tab-' || gen_random_uuid() || '@example.test',
  '{"provider":"email"}', jsonb_build_object('full_name', E'\tBob Builder\n')) as tab_id \gset
select is((select full_name from public.profiles where id = :'tab_id'), 'Bob Builder',
  'full_name trimmed of tabs/newlines');

-- An executor who is the assignee of a task cannot stop being an executor (by SQL or app_metadata):
-- otherwise "assignee is an executor" would silently break.
insert into public.objects (name, address) values ('Role guard object', 'Addr') returning id as rg_obj \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'rg_obj', 'Role guard task', :'exec_id', :'mgr_id');
select throws_ok(format($$ update public.profiles set role = 'manager' where id = %L $$, :'exec_id'),
  'P0001', 'assignee_has_tasks', 'SQL role change of an assignee rejected');
select throws_ok(format($$ update auth.users set raw_app_meta_data = raw_app_meta_data || '{"app_role":"manager"}'
  where id = %L $$, :'exec_id'), 'P0001', 'assignee_has_tasks', 'app_metadata role change of an assignee rejected');
select is((select role::text from public.profiles where id = :'exec_id'), 'executor', 'assignee stays executor');
select lives_ok(format($$ update public.profiles set role = 'manager' where id = %L $$, :'tab_id'),
  'executor without tasks can be promoted');
select lives_ok(format($$ update public.profiles set full_name = 'Renamed' where id = %L $$, :'exec_id'),
  'other profile updates of an assignee are allowed');
-- Only active tasks count: an executor whose tasks are all soft-deleted can be promoted.
select tests.create_user('p-soft-' || gen_random_uuid() || '@example.test') as soft_exec \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'rg_obj', 'Soft-deleted task', :'soft_exec', :'mgr_id') returning id as soft_task \gset
update public.tasks set deleted_at = now(), deleted_by = :'mgr_id' where id = :'soft_task';
select lives_ok(format($$ update public.profiles set role = 'manager' where id = %L $$, :'soft_exec'),
  'executor whose tasks are all deleted can be promoted');

-- Deleting the auth user removes the profile (no tasks reference it).
delete from auth.users where id = :'norole_id';
select is_empty(format($$ select 1 from public.profiles where id = %L $$, :'norole_id'),
  'profile removed with auth user');

-- Users cannot change profiles (no role escalation), and see their own profile.
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.profiles where id = :'exec_id'), 1, 'user reads own profile');
select throws_ok(format($$ update public.profiles set role = 'manager' where id = %L $$, :'exec_id'),
  '42501', null, 'executor cannot update own role');
select throws_ok(format($$ insert into public.profiles (id, email, full_name, role) values (%L, 'x@x.test', 'x', 'manager') $$,
  gen_random_uuid()), '42501', null, 'executor cannot insert profiles');
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ update public.profiles set role = 'executor' where id = %L $$, :'exec_id'),
  '42501', null, 'manager cannot update roles via API');
select tests.clear_authentication();
select is((select role::text from public.profiles where id = :'exec_id'), 'executor', 'role unchanged');

-- Mandatory password change on first login, enforced by the database.
select has_trigger('auth', 'users', 'on_auth_user_password_changed', 'trigger on_auth_user_password_changed exists');
select is((select must_change_password from public.profiles where id = :'mgr_id'), true,
  'new user must change the password');

insert into public.objects (name, address) values ('Gate object', 'Addr') returning id as gate_obj \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'gate_obj', 'Gate task', :'exec_id', :'mgr_id') returning id as gate_task \gset

-- While the flag is set: only the own profile is visible; no objects, tasks, history, no RPC.
select tests.authenticate_as(:'mgr_id');
select is((select count(*)::int from public.objects), 0, 'flagged manager sees no objects');
select is((select count(*)::int from public.tasks), 0, 'flagged manager sees no tasks');
select is((select count(*)::int from public.task_status_history), 0, 'flagged manager sees no history');
select is((select array_agg(id) from public.profiles), array[:'mgr_id'::uuid], 'flagged manager sees only own profile');
select throws_ok($$ insert into public.objects (name, address) values ('x', 'y') $$, '42501', null,
  'flagged manager cannot create objects');
select throws_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'gate_task'),
  'P0001', 'task_not_found', 'flagged manager RPC fails with task_not_found');
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.tasks), 0, 'flagged executor does not see own task');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'gate_task'),
  'P0001', 'task_not_found', 'flagged executor cannot change status (task_not_found)');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, gen_random_uuid()),
  'P0001', 'task_not_found', 'flagged executor: nonexistent task gives the same error');
-- The client cannot clear the flag itself.
select throws_ok(format($$ update public.profiles set must_change_password = false where id = %L $$, :'exec_id'),
  '42501', null, 'client cannot clear must_change_password');
select tests.clear_authentication();

-- Updating other columns or re-writing the same password hash does not clear the flag.
update auth.users set raw_user_meta_data = '{"full_name":"Other"}', updated_at = now() where id = :'exec_id';
update auth.users set encrypted_password = encrypted_password where id = :'exec_id';
select is((select must_change_password from public.profiles where id = :'exec_id'), true,
  'flag stays when the password is not changed');

-- A real password change clears the flag and opens access.
update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf'))
 where id in (:'exec_id', :'mgr_id');
select is((select must_change_password from public.profiles where id = :'exec_id'), false,
  'password change clears the flag');
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.tasks where id = :'gate_task'), 1, 'executor sees own task after change');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'gate_task'),
  'executor can change status after change');
select tests.authenticate_as(:'mgr_id');
select is((select count(*)::int from public.objects where id = :'gate_obj'), 1, 'manager sees objects after change');
select tests.clear_authentication();

select * from finish();
rollback;
