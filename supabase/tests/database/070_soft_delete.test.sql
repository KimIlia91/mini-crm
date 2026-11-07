-- Soft delete of tasks and objects: public.delete_task / public.delete_object, visibility of
-- deleted rows, no client DELETE, no writes to deleted_at/deleted_by, admin restore checks.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(50);

select tests.create_user('sd-mgr-' || gen_random_uuid() || '@example.test') as mgr_id \gset
select tests.create_user('sd-new-mgr-' || gen_random_uuid() || '@example.test') as new_mgr_id \gset
select tests.create_user('sd-exec-' || gen_random_uuid() || '@example.test') as exec_id \gset
update public.profiles set role = 'manager' where id in (:'mgr_id', :'new_mgr_id');
-- Password change activates mgr and exec; new_mgr keeps must_change_password (no effective role).
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'mgr_id', :'exec_id');

insert into public.objects (name, address) values ('SD object', 'Addr') returning id as obj_id \gset
insert into public.objects (name, address) values ('SD empty object', 'Addr') returning id as empty_obj \gset
insert into public.objects (name, address) values ('SD active object', 'Addr') returning id as active_obj \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'obj_id', 'SD task 1', :'exec_id', :'mgr_id') returning id as t1 \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'obj_id', 'SD task 2', :'exec_id', :'mgr_id') returning id as t2 \gset

-- Function shape: public wrappers are SECURITY INVOKER, implementations DEFINER in private.
select is((select prosecdef from pg_proc where oid = 'public.delete_task(uuid)'::regprocedure), false,
  'public.delete_task is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.delete_task(uuid)'::regprocedure), true,
  'private.delete_task is security definer');
select is((select prosecdef from pg_proc where oid = 'public.delete_object(uuid)'::regprocedure), false,
  'public.delete_object is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.delete_object(uuid)'::regprocedure), true,
  'private.delete_object is security definer');

-- delete_task: only an activated manager; everything else is task_not_found.
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ select public.delete_task(%L) $$, :'t1'), 'P0001', 'task_not_found',
  'assignee executor cannot delete a task');
select tests.authenticate_as(:'new_mgr_id');
select throws_ok(format($$ select public.delete_task(%L) $$, :'t1'), 'P0001', 'task_not_found',
  'manager without changed password cannot delete a task');
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.delete_task(%L) $$, gen_random_uuid()), 'P0001', 'task_not_found',
  'nonexistent task gives task_not_found');
select tests.clear_authentication();
select ok((select deleted_at is null from public.tasks where id = :'t1'), 'rejected attempts change nothing');

select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.delete_task(%L) $$, :'t1'), 'manager deletes a task');
select throws_ok(format($$ select public.delete_task(%L) $$, :'t1'), 'P0001', 'task_not_found',
  'repeated delete gives task_not_found');
select is_empty(format($$ select 1 from public.tasks where id = %L $$, :'t1'), 'manager does not see the deleted task');
select is_empty(format($$ update public.tasks set title = 'Edited' where id = %L returning id $$, :'t1'),
  'manager cannot edit a deleted task (0 rows)');
select tests.authenticate_as(:'exec_id');
select is_empty(format($$ select 1 from public.tasks where id = %L $$, :'t1'), 'assignee does not see the deleted task');
select is((select count(*)::int from public.tasks where id = :'t2'), 1, 'assignee still sees the active task');
select tests.clear_authentication();
select ok((select deleted_at is not null and deleted_at <= now() and deleted_by = :'mgr_id'::uuid
             from public.tasks where id = :'t1'), 'deleted_at/deleted_by set by the database');
select is((select title from public.tasks where id = :'t1'), 'SD task 1', 'deleted task row is kept unchanged');

-- Clients cannot hard-delete nor write the soft-delete columns.
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ delete from public.tasks where id = %L $$, :'t2'), '42501', null,
  'client DELETE on tasks is denied');
select throws_ok(format($$ delete from public.objects where id = %L $$, :'empty_obj'), '42501', null,
  'client DELETE on objects is denied');
select throws_ok(format($$ update public.tasks set deleted_at = null, deleted_by = null where id = %L $$, :'t1'),
  '42501', null, 'client cannot restore a task via update');
select throws_ok(format($$ update public.tasks set deleted_at = now(), deleted_by = %L where id = %L $$, :'mgr_id', :'t2'),
  '42501', null, 'client cannot soft-delete a task via update');
select throws_ok(format($$ update public.objects set deleted_at = now(), deleted_by = %L where id = %L $$,
  :'mgr_id', :'empty_obj'), '42501', null, 'client cannot soft-delete an object via update');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, deleted_at, deleted_by)
  values (%L, 'x', %L, now(), %L) $$, :'obj_id', :'exec_id', :'mgr_id'), '42501', null,
  'client cannot insert a task with deleted_at');
select throws_ok(format($$ insert into public.objects (name, address, deleted_at, deleted_by)
  values ('x', 'y', now(), %L) $$, :'mgr_id'), '42501', null, 'client cannot insert an object with deleted_at');
select tests.clear_authentication();

-- delete_object: only an activated manager; blocked while the object has active tasks.
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ select public.delete_object(%L) $$, :'obj_id'), 'P0001', 'object_not_found',
  'executor cannot delete an object');
select tests.authenticate_as(:'new_mgr_id');
select throws_ok(format($$ select public.delete_object(%L) $$, :'obj_id'), 'P0001', 'object_not_found',
  'manager without changed password cannot delete an object');
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.delete_object(%L) $$, gen_random_uuid()), 'P0001', 'object_not_found',
  'nonexistent object gives object_not_found');
select throws_ok(format($$ select public.delete_object(%L) $$, :'obj_id'), 'P0001', 'object_has_tasks',
  'object with an active task cannot be deleted');
select lives_ok(format($$ select public.delete_task(%L) $$, :'t2'), 'manager deletes the last active task');
select tests.authenticate_as(:'exec_id');
select is_empty(format($$ select 1 from public.objects where id = %L $$, :'obj_id'),
  'executor does not see an object with only deleted tasks');
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.delete_object(%L) $$, :'obj_id'),
  'object is deleted once all its tasks are deleted');
select throws_ok(format($$ select public.delete_object(%L) $$, :'obj_id'), 'P0001', 'object_not_found',
  'repeated object delete gives object_not_found');
select is_empty(format($$ select 1 from public.objects where id = %L $$, :'obj_id'),
  'manager does not see the deleted object');
select is_empty(format($$ update public.objects set name = 'Edited' where id = %L returning id $$, :'obj_id'),
  'manager cannot edit a deleted object (0 rows)');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'obj_id', :'exec_id'), 'P0001', 'object_not_found', 'task cannot be created in a deleted object');
select lives_ok(format($$ select public.delete_object(%L) $$, :'empty_obj'), 'empty object is deleted');
-- Manager behaviour of the insert triggers is unchanged.
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  gen_random_uuid(), :'exec_id'), 'P0001', 'object_not_found', 'manager: random object gives object_not_found');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'active_obj', :'mgr_id'), 'P0001', 'assignee_not_executor', 'manager: manager as assignee is rejected');

-- No existence oracle for non-managers: every task insert is 42501, whatever the object/assignee.
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'obj_id', :'exec_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'executor: insert into a deleted object is 42501');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  gen_random_uuid(), :'exec_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'executor: insert into a random object is 42501');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'active_obj', :'mgr_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'executor: manager as assignee is 42501');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'active_obj', :'exec_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'executor: valid object and assignee is 42501 too');
select tests.authenticate_as(:'new_mgr_id');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'obj_id', :'exec_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'not-activated manager: insert into a deleted object is 42501');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  gen_random_uuid(), :'exec_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'not-activated manager: insert into a random object is 42501');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'x', %L) $$,
  :'active_obj', :'mgr_id'), '42501', 'new row violates row-level security policy for table "tasks"',
  'not-activated manager: manager as assignee is 42501');
select tests.clear_authentication();
select ok((select deleted_at is not null and deleted_by = :'mgr_id'::uuid from public.objects where id = :'obj_id'),
  'object deleted_at/deleted_by set by the database');

-- anon cannot execute the RPCs.
select tests.authenticate_anon();
select throws_ok(format($$ select public.delete_task(%L) $$, :'t2'), '42501', null, 'anon cannot execute delete_task');
select throws_ok(format($$ select public.delete_object(%L) $$, :'obj_id'), '42501', null,
  'anon cannot execute delete_object');
select tests.clear_authentication();

-- Admin restore (SQL only) re-validates: a task cannot be restored into a deleted object.
select throws_ok(format($$ update public.tasks set deleted_at = null, deleted_by = null where id = %L $$, :'t1'),
  'P0001', 'object_not_found', 'restoring a task into a deleted object is rejected');
update public.objects set deleted_at = null, deleted_by = null where id = :'obj_id';
select lives_ok(format($$ update public.tasks set deleted_at = null, deleted_by = null where id = %L $$, :'t1'),
  'task is restored after its object');
select tests.authenticate_as(:'exec_id');
select is((select count(*)::int from public.tasks where id = :'t1'), 1, 'restored task is visible again');
select tests.clear_authentication();

select * from finish();
rollback;
