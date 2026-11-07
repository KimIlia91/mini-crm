-- Task status history: written only by the database, immutable for clients, cascades with the task.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(20);

select tests.create_user('h-mgr-' || gen_random_uuid() || '@example.test') as mgr_id \gset
select tests.create_user('h-exec-' || gen_random_uuid() || '@example.test') as exec_id \gset
update public.profiles set role = 'manager' where id = :'mgr_id';
-- Simulate the mandatory first password change, so the users get effective roles.
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'mgr_id', :'exec_id');
insert into public.objects (name, address) values ('History object', 'Addr') returning id as obj_id \gset

-- Creating a task (as the manager, through the client role) writes the first history row.
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'History task', %L) $$,
  :'obj_id', :'exec_id'), 'manager creates a task');
select tests.clear_authentication();
select id as task_id from public.tasks where title = 'History task' and object_id = :'obj_id' \gset

select is((select author_id from public.tasks where id = :'task_id'), :'mgr_id'::uuid,
  'author_id defaults to the caller');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by, comment from public.task_status_history
             where task_id = %L $$, :'task_id'),
  format($$ values (null::text, 'new', %L::uuid, null::text) $$, :'mgr_id'),
  'task insert writes exactly one history row: null -> new by the author'
);
select ok((select changed_at is not null from public.task_status_history where task_id = :'task_id'),
  'changed_at is set');

select tests.authenticate_as(:'exec_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'task_id'), 'executor takes the task');
select tests.clear_authentication();
select id as hist_id from public.task_status_history where task_id = :'task_id' order by id desc limit 1 \gset

-- Clients cannot forge, change or delete history (manager and executor alike).
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (%L, 'in_progress', 'in_review', %L) $$, :'task_id', :'mgr_id'), '42501', null, 'manager cannot insert history');
select throws_ok(format($$ update public.task_status_history set comment = 'forged' where id = %L $$, :'hist_id'),
  '42501', null, 'manager cannot update history');
select throws_ok(format($$ delete from public.task_status_history where id = %L $$, :'hist_id'),
  '42501', null, 'manager cannot delete history');
select throws_ok($$ truncate public.task_status_history $$, '42501', null, 'manager cannot truncate history');

select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (%L, 'in_progress', 'in_review', %L) $$, :'task_id', :'exec_id'), '42501', null, 'executor cannot insert history');
select throws_ok(format($$ update public.task_status_history set comment = 'forged' where id = %L $$, :'hist_id'),
  '42501', null, 'executor cannot update history');
select throws_ok(format($$ delete from public.task_status_history where id = %L $$, :'hist_id'),
  '42501', null, 'executor cannot delete history');
select tests.clear_authentication();

select is((select count(*)::int from public.task_status_history where task_id = :'task_id'), 2,
  'history unchanged after forbidden attempts');
select is((select comment from public.task_status_history where id = :'hist_id'), null::text,
  'history row content unchanged');

-- History is read through tasks visibility: the assignee sees it.
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.task_status_history where task_id = :'task_id'), 2,
  'assignee reads the task history');
select tests.clear_authentication();

-- Clients cannot hard-delete tasks; soft delete keeps the history but hides it from clients.
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ delete from public.tasks where id = %L $$, :'task_id'),
  '42501', null, 'client DELETE on tasks is denied');
select lives_ok(format($$ select public.delete_task(%L) $$, :'task_id'), 'manager soft-deletes the task');
select is((select count(*)::int from public.task_status_history where task_id = :'task_id'), 0,
  'manager does not see the history of a deleted task');
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.task_status_history where task_id = :'task_id'), 0,
  'assignee does not see the history of a deleted task');
select tests.clear_authentication();
select is((select count(*)::int from public.task_status_history where task_id = :'task_id'), 2,
  'history of a deleted task is kept in the database');

select * from finish();
rollback;
