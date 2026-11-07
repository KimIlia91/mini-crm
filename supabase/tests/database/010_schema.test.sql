-- CRM core schema: tables, enums, keys, foreign key actions, checks, indexes, transition rules.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(80);

-- Enums
select enum_has_labels('public', 'app_role', array['manager', 'executor'], 'app_role labels');
select enum_has_labels('public', 'task_status',
  array['new', 'in_progress', 'in_review', 'accepted', 'rework'], 'task_status labels');

-- Tables
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'objects', 'objects exists');
select has_table('public', 'tasks', 'tasks exists');
select has_table('public', 'task_status_history', 'task_status_history exists');
select has_table('public', 'task_transitions', 'task_transitions exists');

-- Columns: exact sets
select columns_are('public', 'profiles',
  array['id', 'email', 'full_name', 'role', 'must_change_password', 'created_at'],
  'profiles columns');
select columns_are('public', 'objects',
  array['id', 'name', 'address', 'created_at', 'deleted_at', 'deleted_by'], 'objects columns');
select columns_are('public', 'tasks',
  array['id', 'object_id', 'title', 'description', 'assignee_id', 'status', 'author_id', 'created_at',
        'deleted_at', 'deleted_by', 'status_rank'],
  'tasks columns');
select columns_are('public', 'task_status_history',
  array['id', 'task_id', 'from_status', 'to_status', 'changed_by', 'comment', 'changed_at'],
  'task_status_history columns');
select columns_are('public', 'task_transitions',
  array['from_status', 'to_status', 'actor_role', 'comment_required'], 'task_transitions columns');

-- Types
select col_type_is('public', 'profiles', 'role', 'app_role', 'profiles.role is app_role');
select col_type_is('public', 'tasks', 'status', 'task_status', 'tasks.status is task_status');
select col_type_is('public', 'task_status_history', 'id', 'bigint', 'history.id is bigint');
select col_type_is('public', 'task_status_history', 'from_status', 'task_status', 'history.from_status type');
select col_type_is('public', 'task_status_history', 'to_status', 'task_status', 'history.to_status type');
select col_type_is('public', 'task_transitions', 'actor_role', 'app_role', 'transitions.actor_role type');

-- NOT NULL / NULL
select col_not_null('public', 'profiles', 'email', 'profiles.email not null');
select col_not_null('public', 'profiles', 'full_name', 'profiles.full_name not null');
select col_not_null('public', 'profiles', 'role', 'profiles.role not null');
select col_not_null('public', 'profiles', 'must_change_password', 'profiles.must_change_password not null');
select col_not_null('public', 'objects', 'name', 'objects.name not null');
select col_not_null('public', 'objects', 'address', 'objects.address not null');
select col_not_null('public', 'tasks', 'object_id', 'tasks.object_id not null');
select col_not_null('public', 'tasks', 'title', 'tasks.title not null');
select col_not_null('public', 'tasks', 'description', 'tasks.description not null');
select col_not_null('public', 'tasks', 'assignee_id', 'tasks.assignee_id not null');
select col_not_null('public', 'tasks', 'status', 'tasks.status not null');
select col_not_null('public', 'tasks', 'author_id', 'tasks.author_id not null');
select col_not_null('public', 'tasks', 'created_at', 'tasks.created_at not null');
select col_is_null('public', 'task_status_history', 'from_status', 'history.from_status nullable (creation)');
select col_not_null('public', 'task_status_history', 'to_status', 'history.to_status not null');
select col_not_null('public', 'task_status_history', 'changed_by', 'history.changed_by not null');
select col_is_null('public', 'task_status_history', 'comment', 'history.comment nullable');
select col_not_null('public', 'task_status_history', 'changed_at', 'history.changed_at not null');

-- Defaults
select col_default_is('public', 'profiles', 'must_change_password', true,
  'profiles.must_change_password defaults to true');
select col_default_is('public', 'tasks', 'status', 'new'::public.task_status, 'tasks.status defaults to new');
select col_default_is('public', 'tasks', 'description', ''::text, 'tasks.description defaults to empty');
select col_default_is('public', 'tasks', 'author_id', 'auth.uid()', 'tasks.author_id defaults to auth.uid()');

-- Primary keys
select col_is_pk('public', 'profiles', 'id', 'profiles pk');
select col_is_pk('public', 'objects', 'id', 'objects pk');
select col_is_pk('public', 'tasks', 'id', 'tasks pk');
select col_is_pk('public', 'task_status_history', 'id', 'history pk');
select col_is_pk('public', 'task_transitions', array['from_status', 'to_status'], 'transitions pk');

-- Foreign keys with exact names and delete actions (r = restrict, c = cascade)
select results_eq(
  $$ select conname::text collate "default", conrelid::regclass::text, confrelid::regclass::text,
            confdeltype::text collate "default"
       from pg_constraint
      where contype = 'f'
        and conrelid in ('public.profiles'::regclass, 'public.tasks'::regclass,
                         'public.task_status_history'::regclass, 'public.objects'::regclass,
                         'public.task_transitions'::regclass)
      order by conname $$,
  $$ values ('objects_deleted_by_fkey', 'objects', 'profiles', 'r'),
            ('profiles_id_fkey', 'profiles', 'auth.users', 'c'),
            ('task_status_history_changed_by_fkey', 'task_status_history', 'profiles', 'r'),
            ('task_status_history_task_id_fkey', 'task_status_history', 'tasks', 'c'),
            ('tasks_assignee_id_fkey', 'tasks', 'profiles', 'r'),
            ('tasks_author_id_fkey', 'tasks', 'profiles', 'r'),
            ('tasks_deleted_by_fkey', 'tasks', 'profiles', 'r'),
            ('tasks_object_id_fkey', 'tasks', 'objects', 'r') $$,
  'foreign keys: names, targets and on delete actions'
);

-- Indexes under FKs and frequent filters
select has_index('public', 'tasks', 'tasks_assignee_id_idx', array['assignee_id'], 'index tasks(assignee_id)');
select has_index('public', 'tasks', 'tasks_object_id_assignee_id_idx', array['object_id', 'assignee_id'],
  'index tasks(object_id, assignee_id)');
select has_index('public', 'tasks', 'tasks_author_id_idx', array['author_id'], 'index tasks(author_id)');
select has_index('public', 'tasks', 'tasks_deleted_by_idx', array['deleted_by'], 'index tasks(deleted_by)');
select has_index('public', 'objects', 'objects_deleted_by_idx', array['deleted_by'], 'index objects(deleted_by)');

-- Soft-delete columns: nullable (null = active), timestamptz.
select col_is_null('public', 'tasks', 'deleted_at', 'tasks.deleted_at nullable');
select col_is_null('public', 'objects', 'deleted_at', 'objects.deleted_at nullable');
select col_type_is('public', 'tasks', 'deleted_at', 'timestamp with time zone', 'tasks.deleted_at is timestamptz');
select col_type_is('public', 'objects', 'deleted_at', 'timestamp with time zone', 'objects.deleted_at is timestamptz');
select has_index('public', 'task_status_history', 'task_status_history_task_id_id_idx',
  array['task_id', 'id'], 'index history(task_id, id)');
select has_index('public', 'task_status_history', 'task_status_history_changed_by_idx',
  array['changed_by'], 'index history(changed_by)');

-- Transition rules: exactly the 5 rules from the specification
select set_eq(
  $$ select from_status::text, to_status::text, actor_role::text, comment_required
       from public.task_transitions $$,
  $$ values ('new', 'in_progress', 'executor', false),
            ('in_progress', 'in_review', 'executor', false),
            ('in_review', 'accepted', 'manager', false),
            ('in_review', 'rework', 'manager', true),
            ('rework', 'in_progress', 'executor', false) $$,
  'task_transitions has exactly the 5 allowed rules'
);

-- CHECK constraints (behaviour, as postgres)
select tests.create_user('schema-exec-' || gen_random_uuid() || '@example.test') as exec_id \gset
select tests.create_user('schema-mgr-' || gen_random_uuid() || '@example.test') as mgr_id \gset
update public.profiles set role = 'manager' where id = :'mgr_id';

select throws_ok($$ insert into public.objects (name, address) values ('   ', 'addr') $$, '23514', null,
  'objects.name blank rejected');
select throws_ok(format($$ insert into public.objects (name, address) values (%L, 'addr') $$, repeat('a', 201)),
  '23514', null, 'objects.name > 200 rejected');
select throws_ok($$ insert into public.objects (name, address) values ('n', '') $$, '23514', null,
  'objects.address empty rejected');
select lives_ok(format($$ insert into public.objects (name, address) values (%L, %L) $$,
  repeat('a', 200), repeat('b', 500)), 'objects name 200 / address 500 accepted (boundary)');

insert into public.objects (name, address) values ('Schema object', 'Addr') returning id as obj_id \gset

select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, author_id)
  values (%L, ' ', %L, %L) $$, :'obj_id', :'exec_id', :'mgr_id'), '23514', null, 'tasks.title blank rejected');
select throws_ok(format($$ insert into public.tasks (object_id, title, description, assignee_id, author_id)
  values (%L, 't', %L, %L, %L) $$, :'obj_id', repeat('d', 5001), :'exec_id', :'mgr_id'), '23514', null,
  'tasks.description > 5000 rejected');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, author_id)
  values (%L, 't', %L, %L) $$, :'obj_id', :'mgr_id', :'mgr_id'), 'P0001', 'assignee_not_executor',
  'assignee must be an executor');

insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'obj_id', 'Schema task', :'exec_id', :'mgr_id') returning id as task_id \gset

select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (%L, 'new', 'new', %L) $$, :'task_id', :'mgr_id'), '23514', null, 'history from = to rejected');
select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (%L, 'in_review', 'rework', %L) $$, :'task_id', :'mgr_id'), '23514', null,
  'history rework without comment rejected');
select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
  values (%L, 'in_review', 'accepted', %L, '  ') $$, :'task_id', :'mgr_id'), '23514', null,
  'history blank comment rejected');
select throws_ok($$ delete from public.objects where name = 'Schema object' $$, '23503', null,
  'object with tasks cannot be deleted (restrict)');

-- deleted_at and deleted_by are set together or not at all.
select throws_ok(format($$ update public.tasks set deleted_at = now() where id = %L $$, :'task_id'),
  '23514', null, 'tasks.deleted_at without deleted_by rejected');
select throws_ok(format($$ update public.tasks set deleted_by = %L where id = %L $$, :'mgr_id', :'task_id'),
  '23514', null, 'tasks.deleted_by without deleted_at rejected');
select throws_ok($$ update public.objects set deleted_at = now() where name = 'Schema object' $$,
  '23514', null, 'objects.deleted_at without deleted_by rejected');
select throws_ok(format($$ update public.objects set deleted_by = %L where name = 'Schema object' $$, :'mgr_id'),
  '23514', null, 'objects.deleted_by without deleted_at rejected');

-- Blank means any ASCII whitespace (space, tab, newline, CR, FF, VT), not only spaces.
select throws_ok($$ insert into public.objects (name, address) values (E'\t\n', 'addr') $$, '23514', null,
  'objects.name of tab/newline rejected');
select throws_ok($$ insert into public.objects (name, address) values ('n', E'\n') $$, '23514', null,
  'objects.address of newline rejected');
select throws_ok($$ insert into public.objects (name, address) values (E'\r\f\x0b ', 'addr') $$, '23514', null,
  'objects.name of CR/FF/VT rejected');
select throws_ok(format($$ insert into public.tasks (object_id, title, assignee_id, author_id)
  values (%L, E'\t\n', %L, %L) $$, :'obj_id', :'exec_id', :'mgr_id'), '23514', null,
  'tasks.title of tab/newline rejected');
select throws_ok(format($$ update public.profiles set full_name = E'\n\t' where id = %L $$, :'exec_id'),
  '23514', null, 'profiles.full_name of newline/tab rejected');
select throws_ok(format($$ insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
  values (%L, 'in_review', 'rework', %L, E'\t\n') $$, :'task_id', :'mgr_id'), '23514', null,
  'history comment of tab/newline rejected');
-- Length is measured on the trimmed value; inner whitespace and the letter v are kept.
select lives_ok(format($$ insert into public.objects (name, address) values (%L, E'\tvv\n') $$,
  E'\t' || repeat('a', 200) || E'\n'), 'surrounding whitespace does not count towards the length');

select * from finish();
rollback;
