-- Server-side lists: generated tasks.status_rank and the partial indexes used by the paginated
-- lists and the board (shape, client cannot write the rank, plans use the indexes).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(21);

-- Plan text of a query, run with the caller's privileges (RLS applies to the client role).
create function tests.plan_of(p_query text)
returns text
language plpgsql
as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain (costs off) ' || p_query loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;
grant execute on function tests.plan_of(text) to authenticated;

select tests.create_user('li-mgr-' || gen_random_uuid() || '@example.test') as mgr_id \gset
select tests.create_user('li-exec-' || gen_random_uuid() || '@example.test') as exec_id \gset
update public.profiles set role = 'manager' where id = :'mgr_id';
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'mgr_id', :'exec_id');

insert into public.objects (name, address) values ('LI object', 'Addr') returning id as obj_id \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'obj_id', 'LI task', :'exec_id', :'mgr_id') returning id as task_id \gset

-- Column shape
select col_type_is('public', 'tasks', 'status_rank', 'smallint', 'tasks.status_rank is smallint');
select col_not_null('public', 'tasks', 'status_rank', 'tasks.status_rank not null');
select is((select attgenerated from pg_attribute
            where attrelid = 'public.tasks'::regclass and attname = 'status_rank'),
  's'::"char", 'tasks.status_rank is a stored generated column');

-- Rank for every status: the workflow order, tasks needing action first.
-- Created as 'new' (initial history must be valid), then moved directly as the owner: the
-- rank is recomputed on update too.
insert into public.tasks (object_id, title, assignee_id, author_id)
select :'obj_id', 'LI rank ' || s, :'exec_id', :'mgr_id'
  from unnest(enum_range(null::public.task_status)) s;
update public.tasks set status = substr(title, 9)::public.task_status where title like 'LI rank %';
select results_eq(
  $$ select status, status_rank from public.tasks where title like 'LI rank %' order by status_rank $$,
  $$ values ('rework'::public.task_status, 0::smallint), ('new', 1::smallint), ('in_progress', 2::smallint),
            ('in_review', 3::smallint), ('accepted', 4::smallint) $$,
  'status_rank: rework=0, new=1, in_progress=2, in_review=3, accepted=4');
select results_eq(
  $$ select count(*)::int from public.tasks
      where status_rank is distinct from array_position(
        array['rework','new','in_progress','in_review','accepted']::public.task_status[], status) - 1 $$,
  $$ values (0) $$,
  'status_rank follows the status of every row');
select is(array_length(enum_range(null::public.task_status), 1), 5, 'all enum statuses are ranked');

-- Clients read the rank but never write it (generated + no column grant).
select ok(has_column_privilege('authenticated', 'public.tasks', 'status_rank', 'SELECT'),
  'tasks.status_rank readable by authenticated');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'status_rank', 'INSERT'),
  'tasks.status_rank not insertable by authenticated');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'status_rank', 'UPDATE'),
  'tasks.status_rank not updatable by authenticated');
select throws_ok(format($$ update public.tasks set status_rank = 4 where id = %L $$, :'task_id'),
  '428C9', null, 'generated status_rank cannot be set even by the owner');

select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, status_rank)
  values (%L, 'LI rank', %L, 0) $$, :'obj_id', :'exec_id'), '428C9', null,
  'authenticated cannot insert status_rank');
select throws_ok(format($$ update public.tasks set status_rank = 0 where id = %L $$, :'task_id'),
  '428C9', null, 'authenticated cannot update status_rank');
-- Even the only form Postgres allows for a generated column (DEFAULT) is denied by grants.
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, status_rank)
  values (%L, 'LI rank', %L, default) $$, :'obj_id', :'exec_id'), '42501', null,
  'authenticated has no insert privilege on status_rank');
select throws_ok(format($$ update public.tasks set status_rank = default where id = %L $$, :'task_id'),
  '42501', null, 'authenticated has no update privilege on status_rank');
select is((select status_rank from public.tasks where id = :'task_id'), 1::smallint,
  'authenticated reads status_rank');
select tests.clear_authentication();

-- Indexes: columns, order and the active-rows predicate.
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'tasks_active_object_status_idx'),
  'CREATE INDEX tasks_active_object_status_idx ON public.tasks USING btree (object_id, status, created_at DESC, id DESC) WHERE (deleted_at IS NULL)',
  'index tasks (object_id, status, created_at desc, id desc) where deleted_at is null');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'tasks_active_assignee_status_idx'),
  'CREATE INDEX tasks_active_assignee_status_idx ON public.tasks USING btree (assignee_id, status, created_at DESC, id DESC) WHERE (deleted_at IS NULL)',
  'index tasks (assignee_id, status, created_at desc, id desc) where deleted_at is null');
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'objects_active_name_idx'),
  'CREATE INDEX objects_active_name_idx ON public.objects USING btree (name, id) WHERE (deleted_at IS NULL)',
  'index objects (name, id) where deleted_at is null');

-- Plans under RLS (client role + claims): board column of an object, "my tasks" board
-- column, objects sorted by name. Seq scans are disabled so the tiny test tables still
-- show which index the planner can use.
set local enable_seqscan = off;
select tests.authenticate_as(:'mgr_id');
select matches(
  tests.plan_of(format($$ select id from public.tasks
     where object_id = %L and status = 'new' and deleted_at is null
     order by created_at desc, id desc limit 21 $$, :'obj_id')),
  'tasks_active_object_status_idx', 'object board column uses tasks_active_object_status_idx');
select matches(
  tests.plan_of(format($$ select id from public.tasks
     where assignee_id = %L and status = 'new' and deleted_at is null
     order by created_at desc, id desc limit 21 $$, :'exec_id')),
  'tasks_active_assignee_status_idx', 'my-tasks board column uses tasks_active_assignee_status_idx');
select matches(
  tests.plan_of($$ select id from public.objects where deleted_at is null order by name, id limit 20 $$),
  'objects_active_name_idx', 'objects sorted by name use objects_active_name_idx');
select tests.clear_authentication();

select * from finish();
rollback;
