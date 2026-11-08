-- In-app notifications: written only by database triggers in the same transaction as the event;
-- read with RLS (own rows, effective role required); marked read only through the RPCs; purged
-- after 90 days by pg_cron. Covered here: schema and constraints, grants, RLS, recipients per
-- event, silent resolution of "in review", atomicity, RPC behaviour, purge and the cron job.
-- One snapshot for the whole file: "every manager" is compared with public.profiles, and other
-- suites (integration, e2e) may create managers concurrently in the shared local database.
begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(110);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres): activated managers M1, M2; manager MN and executor EN without an
-- effective role (initial password not changed); activated executors E1, E2.
-- ---------------------------------------------------------------------------------------------
select tests.create_user('nt-m1-' || gen_random_uuid() || '@example.test') as m1_id \gset
select tests.create_user('nt-m2-' || gen_random_uuid() || '@example.test') as m2_id \gset
select tests.create_user('nt-mn-' || gen_random_uuid() || '@example.test') as mn_id \gset
select tests.create_user('nt-e1-' || gen_random_uuid() || '@example.test') as e1_id \gset
select tests.create_user('nt-e2-' || gen_random_uuid() || '@example.test') as e2_id \gset
select tests.create_user('nt-en-' || gen_random_uuid() || '@example.test') as en_id \gset
update public.profiles set role = 'manager' where id in (:'m1_id', :'m2_id', :'mn_id');
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'m1_id', :'m2_id', :'e1_id', :'e2_id');
insert into public.objects (name, address) values ('nt-O', 'Addr') returning id as o_id \gset

-- ---------------------------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------------------------
select enum_has_labels('public', 'notification_kind',
  array['task_assigned', 'task_unassigned', 'task_deleted', 'task_rework', 'task_accepted',
        'task_in_progress', 'task_in_review'],
  'notification_kind labels');
select has_table('public', 'notifications', 'notifications exists');
select set_eq(
  $$ select column_name::text, udt_name::text, is_nullable::text
       from information_schema.columns where table_schema = 'public' and table_name = 'notifications' $$,
  $$ values ('id', 'uuid', 'NO'), ('user_id', 'uuid', 'NO'), ('kind', 'notification_kind', 'NO'),
            ('task_id', 'uuid', 'NO'), ('actor_id', 'uuid', 'YES'), ('title_snapshot', 'text', 'NO'),
            ('comment', 'text', 'YES'), ('created_at', 'timestamptz', 'NO'), ('read_at', 'timestamptz', 'YES'),
            ('resolved_at', 'timestamptz', 'YES'), ('resolved_by', 'uuid', 'YES'), ('resolution', 'text', 'YES') $$,
  'notifications: exact columns, types and nullability');
select col_is_pk('public', 'notifications', 'id', 'notifications pk');
select col_default_is('public', 'notifications', 'id', 'gen_random_uuid()', 'notifications.id defaults to gen_random_uuid()');
select col_default_is('public', 'notifications', 'created_at', 'now()', 'notifications.created_at defaults to now()');
-- r = restrict, c = cascade, n = set null
select set_eq(
  $$ select conname::text, confrelid::regclass::text, confdeltype::text
       from pg_constraint where contype = 'f' and conrelid = 'public.notifications'::regclass $$,
  $$ values ('notifications_user_id_fkey', 'profiles', 'c'), ('notifications_task_id_fkey', 'tasks', 'c'),
            ('notifications_actor_id_fkey', 'profiles', 'n'), ('notifications_resolved_by_fkey', 'profiles', 'n') $$,
  'notifications foreign keys: targets and on delete actions');
select set_eq(
  $$ select indexname::text, indexdef from pg_indexes where schemaname = 'public' and tablename = 'notifications' $$,
  $$ values
     ('notifications_pkey', 'CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)'),
     ('notifications_user_id_created_at_id_idx',
      'CREATE INDEX notifications_user_id_created_at_id_idx ON public.notifications USING btree (user_id, created_at DESC, id DESC)'),
     ('notifications_unread_user_id_idx',
      'CREATE INDEX notifications_unread_user_id_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL)'),
     ('notifications_pending_review_task_id_idx',
      'CREATE INDEX notifications_pending_review_task_id_idx ON public.notifications USING btree (task_id) WHERE ((kind = ''task_in_review''::notification_kind) AND (resolved_at IS NULL))'),
     ('notifications_task_id_idx', 'CREATE INDEX notifications_task_id_idx ON public.notifications USING btree (task_id)'),
     ('notifications_actor_id_idx', 'CREATE INDEX notifications_actor_id_idx ON public.notifications USING btree (actor_id)'),
     ('notifications_resolved_by_idx', 'CREATE INDEX notifications_resolved_by_idx ON public.notifications USING btree (resolved_by)'),
     ('notifications_created_at_idx', 'CREATE INDEX notifications_created_at_idx ON public.notifications USING btree (created_at)') $$,
  'notifications indexes: list (user, newest first), unread, pending review, every FK, purge');

-- CHECK constraints (as postgres).
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'o_id', 'nt-fixture', :'e1_id', :'m1_id') returning id as t0 \gset
create function tests.try_notification(p_kind text, p_title text, p_comment text, p_read_at timestamptz,
                                        p_resolved_at timestamptz, p_resolution text)
returns void
language sql
as $$
  insert into public.notifications (user_id, kind, task_id, title_snapshot, comment, read_at, resolved_at, resolution)
  select t.assignee_id, p_kind::public.notification_kind, t.id, p_title, p_comment, p_read_at, p_resolved_at, p_resolution
    from public.tasks t where t.title = 'nt-fixture';
$$;
select throws_ok($$ select tests.try_notification('task_assigned', ' ', null, null, null, null) $$, '23514', null,
  'blank title_snapshot rejected');
select throws_ok(format($$ select tests.try_notification('task_assigned', %L, null, null, null, null) $$, repeat('a', 201)),
  '23514', null, 'title_snapshot > 200 rejected');
select lives_ok(format($$ select tests.try_notification('task_assigned', %L, null, null, null, null) $$,
  E'\t' || repeat('a', 200) || E'\n'), 'title_snapshot of 200 characters accepted (trimmed length, as tasks.title)');
select throws_ok($$ select tests.try_notification('task_rework', 't', null, null, null, null) $$, '23514', null,
  'task_rework without comment rejected');
select throws_ok($$ select tests.try_notification('task_assigned', 't', 'c', null, null, null) $$, '23514', null,
  'comment on a kind other than task_rework rejected');
select throws_ok($$ select tests.try_notification('task_rework', 't', E' \t', null, null, null) $$, '23514', null,
  'blank comment rejected');
select throws_ok(format($$ select tests.try_notification('task_rework', 't', %L, null, null, null) $$, repeat('c', 1001)),
  '23514', null, 'comment > 1000 rejected');
select lives_ok(format($$ select tests.try_notification('task_rework', 't', %L, null, null, null) $$, repeat('c', 1000)),
  'comment of 1000 characters accepted (boundary)');
select throws_ok($$ select tests.try_notification('task_in_review', 't', null, now(), now(), null) $$, '23514', null,
  'resolved_at without resolution rejected');
select throws_ok($$ select tests.try_notification('task_in_review', 't', null, now(), null, 'accepted') $$, '23514', null,
  'resolution without resolved_at rejected');
select throws_ok($$ select tests.try_notification('task_in_review', 't', null, now(), now(), 'other') $$, '23514', null,
  'unknown resolution rejected');
select throws_ok($$ select tests.try_notification('task_accepted', 't', null, now(), now(), 'accepted') $$, '23514', null,
  'resolution on a kind other than task_in_review rejected');
select throws_ok($$ select tests.try_notification('task_in_review', 't', null, null, now(), 'accepted') $$, '23514', null,
  'a resolved notification must be read');
select lives_ok($$ select tests.try_notification('task_in_review', 't', null, now(), now(), 'deleted') $$,
  'a read, resolved task_in_review is accepted');
delete from public.notifications where task_id = :'t0';

-- ---------------------------------------------------------------------------------------------
-- Privileges, RLS, function shape
-- ---------------------------------------------------------------------------------------------
select set_eq(
  $$ select r.role, p.priv from unnest(array['anon', 'authenticated']) r(role)
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
      where has_table_privilege(r.role, 'public.notifications', p.priv) $$,
  $$ values ('authenticated', 'SELECT') $$,
  'notifications: authenticated may only SELECT, anon nothing');
select ok(not has_any_column_privilege('authenticated', 'public.notifications', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.notifications', 'UPDATE'),
  'notifications: no column-level writes (read_at only via the RPCs)');
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'RLS is enabled on notifications');
select set_eq(
  $$ select polname::text, polcmd::text from pg_policy where polrelid = 'public.notifications'::regclass $$,
  $$ values ('notifications_select', 'r') $$,
  'notifications: a single SELECT policy');
select has_trigger('public', 'tasks', 'tasks_notify', 'trigger tasks_notify exists');
select has_trigger('public', 'task_status_history', 'history_notify', 'trigger history_notify exists');
select has_trigger('public', 'notifications', 'notifications_broadcast_created', 'trigger notifications_broadcast_created exists');
select has_trigger('public', 'notifications', 'notifications_broadcast_updated', 'trigger notifications_broadcast_updated exists');
select set_eq(
  $$ select p.oid::regprocedure::text, p.prosecdef from pg_proc p
      where p.oid in (to_regprocedure('private.tasks_notify()'), to_regprocedure('private.history_notify()'),
                      to_regprocedure('private.notifications_broadcast()'),
                      to_regprocedure('private.mark_notifications_read(uuid[])'),
                      to_regprocedure('private.mark_all_notifications_read()'),
                      to_regprocedure('public.mark_notifications_read(uuid[])'),
                      to_regprocedure('public.mark_all_notifications_read()'),
                      to_regprocedure('private.purge_old_notifications()')) $$,
  $$ values ('private.tasks_notify()', true), ('private.history_notify()', true),
            ('private.notifications_broadcast()', false),
            ('private.mark_notifications_read(uuid[])', true), ('private.mark_all_notifications_read()', true),
            ('mark_notifications_read(uuid[])', false), ('mark_all_notifications_read()', false),
            ('private.purge_old_notifications()', false) $$,
  'function shape: definer only in private, public RPC wrappers are invoker');
select set_eq(
  $$ select p.oid::regprocedure::text, r.role from pg_proc p
      cross join unnest(array['anon', 'authenticated']) r(role)
      where p.oid in (to_regprocedure('private.tasks_notify()'), to_regprocedure('private.history_notify()'),
                      to_regprocedure('private.notifications_broadcast()'),
                      to_regprocedure('private.mark_notifications_read(uuid[])'),
                      to_regprocedure('private.mark_all_notifications_read()'),
                      to_regprocedure('public.mark_notifications_read(uuid[])'),
                      to_regprocedure('public.mark_all_notifications_read()'),
                      to_regprocedure('private.purge_old_notifications()'))
        and has_function_privilege(r.role, p.oid, 'execute') $$,
  $$ values ('private.mark_notifications_read(uuid[])', 'authenticated'),
            ('private.mark_all_notifications_read()', 'authenticated'),
            ('mark_notifications_read(uuid[])', 'authenticated'),
            ('mark_all_notifications_read()', 'authenticated') $$,
  'EXECUTE: only the read RPCs, only for authenticated');

-- ---------------------------------------------------------------------------------------------
-- Recipients per event
-- ---------------------------------------------------------------------------------------------
-- Created: only the assignee, actor = author, snapshot of the title.
select tests.authenticate_as(:'m1_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'nt-T1', :'e1_id') returning id as t1 \gset
select tests.clear_authentication();
select results_eq(
  format($$ select user_id, kind::text, actor_id, title_snapshot, comment, read_at, resolved_at
              from public.notifications where task_id = %L $$, :'t1'),
  format($$ values (%L::uuid, 'task_assigned'::text, %L::uuid, 'nt-T1'::text, null::text, null::timestamptz,
                    null::timestamptz) $$, :'e1_id', :'m1_id'),
  'task created: only the assignee gets task_assigned (actor = author, title snapshot, unread)');

-- Text edits notify nobody.
select tests.authenticate_as(:'m1_id');
update public.tasks set title = 'nt-T1 v2', description = 'New description' where id = :'t1';
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where task_id = :'t1'), 1,
  'editing title/description notifies nobody');

-- Taken into work: every manager, never the acting assignee.
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t1'), 'E1 takes T1 into work');
select tests.clear_authentication();
select set_eq(format($$ select user_id from public.notifications where task_id = %L and kind = 'task_in_progress' $$, :'t1'),
  $$ select id from public.profiles where role = 'manager' $$,
  'taken into work: every manager gets task_in_progress');
select ok((select bool_and(actor_id = :'e1_id'::uuid and title_snapshot = 'nt-T1 v2')
             from public.notifications where task_id = :'t1' and kind = 'task_in_progress'),
  'task_in_progress: actor is the assignee, title is the current one');
select is((select count(*)::int from public.notifications where task_id = :'t1' and user_id = :'e1_id'), 1,
  'the acting assignee is not notified about his own transition');

-- In review: every manager gets a pending task_in_review.
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t1'), 'E1 sends T1 to review');
select tests.clear_authentication();
select set_eq(
  format($$ select user_id from public.notifications
             where task_id = %L and kind = 'task_in_review' and resolved_at is null and read_at is null $$, :'t1'),
  $$ select id from public.profiles where role = 'manager' $$,
  'in review: every manager gets an unread, pending task_in_review');
select is((select count(*)::int from public.notifications where task_id = :'t1' and user_id = :'m2_id'), 2,
  'M2 has task_in_progress and task_in_review for T1');

-- Rework by M1: the assignee gets the comment; all pending reviews are silently resolved.
select tests.authenticate_as(:'m1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'rework', '  Fix the docs ') $$, :'t1'),
  'M1 returns T1 to rework');
select tests.clear_authentication();
select results_eq(
  format($$ select user_id, actor_id, comment, title_snapshot from public.notifications
             where task_id = %L and kind = 'task_rework' $$, :'t1'),
  format($$ values (%L::uuid, %L::uuid, 'Fix the docs'::text, 'nt-T1 v2'::text) $$, :'e1_id', :'m1_id'),
  'rework: only the assignee gets task_rework with the (trimmed) comment');
select is((select count(*)::int from public.notifications
            where task_id = :'t1' and kind = 'task_in_review'
              and resolution = 'rework' and resolved_by = :'m1_id'::uuid
              and resolved_at is not null and read_at is not null),
  (select count(*)::int from public.profiles where role = 'manager'),
  'rework resolves every pending task_in_review (read, rework, by M1), including M1''s own');
select is((select count(*)::int from public.notifications where task_id = :'t1' and user_id = :'m2_id'), 2,
  'the resolution is silent: M2 gets no new notification');

-- Second round, accepted by M2; the earlier resolution is kept.
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t1'), 'E1 takes T1 into work again');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t1'), 'E1 sends T1 to review again');
select tests.authenticate_as(:'m2_id');
select lives_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'t1'), 'M2 accepts T1');
select tests.clear_authentication();
select results_eq(
  format($$ select user_id, actor_id from public.notifications where task_id = %L and kind = 'task_accepted' $$, :'t1'),
  format($$ values (%L::uuid, %L::uuid) $$, :'e1_id', :'m2_id'),
  'accepted: only the assignee gets task_accepted from M2');
select is((select count(*)::int from public.notifications
            where task_id = :'t1' and kind = 'task_in_review' and resolution = 'accepted' and resolved_by = :'m2_id'::uuid),
  (select count(*)::int from public.profiles where role = 'manager'),
  'accept resolves the second round of reviews as accepted by M2');
select is((select count(*)::int from public.notifications
            where task_id = :'t1' and kind = 'task_in_review' and resolution = 'rework'),
  (select count(*)::int from public.profiles where role = 'manager'),
  'the first round keeps its rework resolution');
select is_empty(format($$ select 1 from public.notifications where task_id = %L and kind = 'task_in_review' and resolved_at is null $$, :'t1'),
  'no pending review is left for T1');

-- The losing / repeated decision creates and resolves nothing.
select count(*) as n_before from public.notifications where task_id = :'t1' \gset
select tests.authenticate_as(:'m1_id');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', 'Late') $$, :'t1'),
  'P0001', 'transition_not_allowed', 'M1 cannot return an accepted task');
select throws_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'t1'),
  'P0001', 'transition_not_allowed', 'a repeated accept is rejected');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where task_id = :'t1'), :n_before,
  'rejected decisions create no notification');
select is((select count(*)::int from public.notifications where task_id = :'t1' and resolved_by = :'m1_id'::uuid
            and resolution = 'accepted'), 0, 'and do not touch the resolutions');

-- Reassignment: assigned to the new, unassigned to the previous assignee; same value -> nothing.
select tests.authenticate_as(:'m1_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'nt-T2', :'e1_id') returning id as t2 \gset
update public.tasks set assignee_id = :'e2_id' where id = :'t2';
select tests.clear_authentication();
select set_eq(format($$ select user_id, kind::text, actor_id from public.notifications where task_id = %L $$, :'t2'),
  format($$ values (%1$L::uuid, 'task_assigned', %3$L::uuid), (%1$L, 'task_unassigned', %3$L), (%2$L, 'task_assigned', %3$L) $$,
         :'e1_id', :'e2_id', :'m1_id'),
  'reassignment: task_unassigned to E1, task_assigned to E2 (actor M1)');
select tests.authenticate_as(:'m1_id');
update public.tasks set assignee_id = :'e2_id', title = 'nt-T2 v2' where id = :'t2';
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where task_id = :'t2'), 3,
  'setting the same assignee notifies nobody');

-- Deletion of a task in review: the assignee is notified, the reviews are resolved as deleted.
select tests.authenticate_as(:'m1_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'nt-T3', :'e1_id') returning id as t3 \gset
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t3'), 'E1 takes T3 into work');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t3'), 'E1 sends T3 to review');
select tests.authenticate_as(:'m1_id');
select lives_ok(format($$ select public.delete_task(%L) $$, :'t3'), 'M1 deletes T3');
select tests.clear_authentication();
select results_eq(
  format($$ select user_id, actor_id, title_snapshot from public.notifications where task_id = %L and kind = 'task_deleted' $$, :'t3'),
  format($$ values (%L::uuid, %L::uuid, 'nt-T3'::text) $$, :'e1_id', :'m1_id'),
  'deleted: only the assignee gets task_deleted (actor = deleter)');
select is((select count(*)::int from public.notifications
            where task_id = :'t3' and kind = 'task_in_review' and resolution = 'deleted'
              and resolved_by = :'m1_id'::uuid and read_at is not null),
  (select count(*)::int from public.profiles where role = 'manager'),
  'deletion resolves every pending review as deleted by M1');
select is_empty(format($$ select 1 from public.notifications where task_id = %L and kind = 'task_in_review' and resolved_at is null $$, :'t3'),
  'no pending review is left for the deleted task');

-- Nobody is notified about his own action (admin SQL: author = assignee).
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'o_id', 'nt-self', :'e1_id', :'e1_id') returning id as t_self \gset
select is_empty(format($$ select 1 from public.notifications where task_id = %L $$, :'t_self'),
  'no notification to the actor himself');

-- Rejected and rolled back transitions create nothing (same transaction as the event).
select tests.authenticate_as(:'m1_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'nt-T4', :'e1_id') returning id as t4 \gset
select tests.authenticate_as(:'e2_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t4'),
  'P0001', 'task_not_found', 'a foreign executor cannot move T4');
select tests.authenticate_as(:'e1_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t4'),
  'P0001', 'transition_not_allowed', 'a skipped step is rejected');
select throws_ok(
  format($f$ do $b$ begin perform public.change_task_status(%L, 'in_progress'); raise exception 'nt_abort'; end $b$ $f$, :'t4'),
  'P0001', 'nt_abort', 'a transition followed by an error in the same transaction');
select tests.clear_authentication();
select is_empty(format($$ select kind from public.notifications where task_id = %L and kind <> 'task_assigned' $$, :'t4'),
  'rejected and rolled back transitions leave no notification');
select is((select status::text from public.tasks where id = :'t4'), 'new', 'and no status change');

-- ---------------------------------------------------------------------------------------------
-- RLS: own rows only, effective role required, no client writes
-- ---------------------------------------------------------------------------------------------
select tests.authenticate_as(:'m1_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'nt-T5', :'en_id') returning id as t5 \gset
select tests.clear_authentication();
select count(*) as e1_count from public.notifications where user_id = :'e1_id' \gset
select id as n_e2 from public.notifications where user_id = :'e2_id' limit 1 \gset
select id as n_en from public.notifications where user_id = :'en_id' and task_id = :'t5' \gset
select ok(:e1_count > 5 and exists (select 1 from public.notifications where user_id = :'mn_id'),
  'fixtures: E1 and the not activated manager have notifications');

select tests.authenticate_as(:'e1_id');
select is((select count(*)::int from public.notifications), :e1_count, 'E1 sees exactly his own notifications');
select is_empty(format($$ select 1 from public.notifications where user_id <> %L $$, :'e1_id'), 'E1 sees no foreign rows');
select is_empty(format($$ select 1 from public.notifications where user_id = %L $$, :'e2_id'),
  'E1 cannot read E2''s notifications by filtering on user_id');
select is_empty(format($$ select 1 from public.notifications where id = %L $$, :'n_e2'), 'nor by id');
select tests.authenticate_as(:'m2_id');
select is_empty(format($$ select 1 from public.notifications where user_id <> %L $$, :'m2_id'),
  'a manager also sees only his own notifications');
select tests.authenticate_as(:'en_id');
select is((select count(*)::int from public.notifications), 0,
  'an executor without an effective role sees no notifications, not even his own');
select tests.authenticate_as(:'mn_id');
select is((select count(*)::int from public.notifications), 0,
  'a manager without an effective role sees no notifications');
select tests.authenticate_anon();
select throws_ok($$ select 1 from public.notifications $$, '42501', 'permission denied for table notifications',
  'anon cannot read notifications');

select tests.authenticate_as(:'e1_id');
select throws_ok(
  format($$ insert into public.notifications (user_id, kind, task_id, title_snapshot) values (%L, 'task_assigned', %L, 'forged') $$,
         :'e1_id', :'t1'),
  '42501', 'permission denied for table notifications', 'authenticated cannot insert notifications');
select throws_ok(format($$ update public.notifications set read_at = now() where user_id = %L $$, :'e1_id'),
  '42501', 'permission denied for table notifications', 'authenticated cannot update notifications directly');
select throws_ok(format($$ delete from public.notifications where user_id = %L $$, :'e1_id'),
  '42501', 'permission denied for table notifications', 'authenticated cannot delete notifications');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------------
-- RPC: mark_notifications_read(ids) / mark_all_notifications_read()
-- ---------------------------------------------------------------------------------------------
select id as n_a from public.notifications where user_id = :'e1_id' and read_at is null order by created_at, id limit 1 \gset
select id as n_b from public.notifications where user_id = :'e1_id' and read_at is null and id <> :'n_a' limit 1 \gset

select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.mark_notifications_read(array[%L, %L]::uuid[]) $$, :'n_a', :'n_e2'),
  'E1 marks his notification and a foreign id');
select tests.clear_authentication();
select ok((select read_at is not null from public.notifications where id = :'n_a'), 'own notification is read');
select ok((select read_at is null from public.notifications where id = :'n_e2'), 'the foreign id is silently ignored');
select ok((select read_at is null from public.notifications where id = :'n_b'), 'other own notifications stay unread');

update public.notifications set read_at = '2000-01-01 00:00:00+00' where id = :'n_a';
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.mark_notifications_read(array[%L]::uuid[]) $$, :'n_a'), 'repeated mark');
select tests.clear_authentication();
select is((select read_at from public.notifications where id = :'n_a'), '2000-01-01 00:00:00+00'::timestamptz,
  'a repeated mark keeps the first read time (idempotent)');

select tests.authenticate_as(:'e1_id');
select throws_ok($$ select public.mark_notifications_read(null) $$, '22023', 'ids_required', 'null ids rejected');
select throws_ok($$ select public.mark_notifications_read(array(select gen_random_uuid() from generate_series(1, 201))) $$,
  '22023', 'too_many_ids', 'more than 200 ids rejected');
select lives_ok($$ select public.mark_notifications_read(array(select gen_random_uuid() from generate_series(1, 200))) $$,
  '200 ids accepted (boundary)');
select lives_ok($$ select public.mark_notifications_read(array[]::uuid[]) $$, 'an empty array is a no-op');
select lives_ok($$ select public.mark_notifications_read(array[null]::uuid[]) $$, 'a null element is ignored');
select tests.clear_authentication();
select ok((select read_at is null from public.notifications where id = :'n_b'), 'the rejected/no-op calls marked nothing');

select tests.authenticate_as(:'e1_id');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'E1 marks all read');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'repeated mark all');
select tests.clear_authentication();
select is((select count(*)::int from public.notifications where user_id = :'e1_id' and read_at is null), 0,
  'mark all: no unread notification of E1 is left');
select ok((select read_at is null from public.notifications where id = :'n_e2'), 'mark all does not touch other users');

select tests.authenticate_as(:'en_id');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'a user without an effective role: mark all');
select lives_ok(format($$ select public.mark_notifications_read(array[%L]::uuid[]) $$, :'n_en'),
  'a user without an effective role: mark own id');
select tests.clear_authentication();
select ok((select read_at is null from public.notifications where id = :'n_en'),
  'without an effective role the RPCs are a no-op');

select tests.authenticate_anon();
select throws_ok($$ select public.mark_all_notifications_read() $$, '42501', null, 'anon cannot call mark_all');
select throws_ok(format($$ select public.mark_notifications_read(array[%L]::uuid[]) $$, :'n_e2'), '42501', null,
  'anon cannot call mark_notifications_read');
select tests.clear_authentication();

-- ---------------------------------------------------------------------------------------------
-- Retention: rows older than 90 days are purged daily by pg_cron.
-- ---------------------------------------------------------------------------------------------
insert into public.notifications (user_id, kind, task_id, title_snapshot, created_at)
values (:'e2_id', 'task_assigned', :'t2', 'nt-old', now() - interval '91 days') returning id as n_old \gset
insert into public.notifications (user_id, kind, task_id, title_snapshot, created_at)
values (:'e2_id', 'task_assigned', :'t2', 'nt-recent', now() - interval '89 days') returning id as n_recent \gset
select has_function('private', 'purge_old_notifications', array[]::text[], 'private.purge_old_notifications() exists');
select function_returns('private', 'purge_old_notifications', array[]::text[], 'integer',
  'purge_old_notifications returns the number of deleted rows');
select private.purge_old_notifications() as purged \gset
select ok(:purged >= 1, 'purge reports deleted rows');
select is_empty(format($$ select 1 from public.notifications where id = %L $$, :'n_old'), 'a 91-day-old notification is purged');
select isnt_empty(format($$ select 1 from public.notifications where id = %L $$, :'n_recent'), 'an 89-day-old notification is kept');

select is((select extnamespace::regnamespace::text from pg_extension where extname = 'pg_cron'), 'pg_catalog',
  'pg_cron is installed in pg_catalog');
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'purge-old-notifications' $$,
  $$ values ('17 3 * * *'::text, 'select private.purge_old_notifications()'::text, true) $$,
  'cron job purge-old-notifications runs daily at 03:17');

select * from finish();
rollback;
