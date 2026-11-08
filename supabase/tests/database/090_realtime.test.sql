-- Realtime hints: database triggers send ids-only hints to private broadcast channels; the client
-- re-reads the data with its own RLS. Covered here:
--   * catalog: nothing in the supabase_realtime publication (no Postgres Changes), one SELECT
--     policy on realtime.messages (no client writes), function/trigger shape and grants;
--   * channel authorization (RLS on realtime.messages): own `user:<uid>`, `role:manager` only for
--     managers with an effective role, the row topic decides (not the realtime.topic setting);
--   * recipients: a recorder replaces private.broadcast inside this transaction and captures every
--     (topic, event, payload) the triggers send; rejected or rolled back requests send nothing.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(76);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as postgres): an activated manager M, a manager N and an executor NE who have not
-- changed the initial password (no effective role), activated executors E1, E2, E3.
-- ---------------------------------------------------------------------------------------------
select tests.create_user('rt-m-' || gen_random_uuid() || '@example.test') as m_id \gset
select tests.create_user('rt-n-' || gen_random_uuid() || '@example.test') as n_id \gset
select tests.create_user('rt-ne-' || gen_random_uuid() || '@example.test') as ne_id \gset
select tests.create_user('rt-e1-' || gen_random_uuid() || '@example.test') as e1_id \gset
select tests.create_user('rt-e2-' || gen_random_uuid() || '@example.test') as e2_id \gset
select tests.create_user('rt-e3-' || gen_random_uuid() || '@example.test') as e3_id \gset
update public.profiles set role = 'manager' where id in (:'m_id', :'n_id');
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'m_id', :'e1_id', :'e2_id', :'e3_id');

-- ---------------------------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------------------------
select has_function('private', 'broadcast', array['text', 'text', 'jsonb'],
  'private.broadcast(topic, event, payload) exists (single sending point)');
select ok(coalesce((select not p.prosecdef
                       and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                    where c in ('search_path=', 'search_path=""'))
                      from pg_proc p where p.oid = to_regprocedure('private.broadcast(text,text,jsonb)')), false),
  'private.broadcast is security invoker with an empty search_path');
select ok(coalesce((select count(*) = 2 and bool_and(p.prosecdef)
                      from pg_proc p
                     where p.oid in (to_regprocedure('private.tasks_broadcast()'),
                                     to_regprocedure('private.objects_broadcast()'))), false),
  'tasks_broadcast / objects_broadcast are security definer (they send for any caller)');
-- Exact trigger set. tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update (5 = AFTER
-- INSERT FOR EACH ROW, 17 = AFTER UPDATE FOR EACH ROW). The update triggers skip no-op updates,
-- so a bulk PATCH that changes nothing cannot flood Realtime.
select set_eq(
  $$ select t.tgrelid::regclass::text, t.tgname::text, t.tgtype::int,
            pg_get_triggerdef(t.oid) ilike '%when ((old.* is distinct from new.*))%'
       from pg_trigger t
      where not t.tgisinternal
        and t.tgfoid in (to_regprocedure('private.tasks_broadcast()'), to_regprocedure('private.objects_broadcast()')) $$,
  $$ values ('tasks', 'tasks_broadcast_insert', 5, false), ('tasks', 'tasks_broadcast_update', 17, true),
            ('objects', 'objects_broadcast_insert', 5, false), ('objects', 'objects_broadcast_update', 17, true) $$,
  'broadcast triggers: AFTER INSERT and AFTER UPDATE FOR EACH ROW, updates only when the row changed');
select ok(coalesce((select count(*) = 3
                           and bool_and(not has_function_privilege('anon', p.oid, 'execute')
                                        and not has_function_privilege('authenticated', p.oid, 'execute'))
                      from pg_proc p
                     where p.oid in (to_regprocedure('private.broadcast(text,text,jsonb)'),
                                     to_regprocedure('private.tasks_broadcast()'),
                                     to_regprocedure('private.objects_broadcast()'))), false),
  'client roles cannot execute the broadcast functions (no forged hints)');

-- No Postgres Changes: project tables are never published (RLS of Postgres Changes would miss
-- the previous assignee and soft-deleted rows; hints go through broadcast instead).
select is_empty(
  $$ select format('%I.%I', schemaname, tablename) from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname in ('public', 'private') $$,
  'no project table is in the supabase_realtime publication');
select is_empty($$ select pubname::text from pg_publication where puballtables $$,
  'no publication covers all tables');

select ok((select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass),
  'RLS is enabled on realtime.messages');
select set_eq(
  $$ select p.polname::text, p.polcmd::text, p.polpermissive,
            (select array_agg(r::regrole::text order by r::regrole::text) from unnest(p.polroles) r)
       from pg_policy p where p.polrelid = 'realtime.messages'::regclass $$,
  $$ values ('realtime_messages_select_own_topics', 'r', true, array['authenticated']) $$,
  'realtime.messages: exactly one permissive SELECT policy for authenticated (no client sends)');

-- ---------------------------------------------------------------------------------------------
-- The real private.broadcast and channel authorization use realtime.messages, which is
-- partitioned by day; partitions are created by the Realtime service. Without today's partition
-- these checks are skipped (realtime.send only warns then).
-- ---------------------------------------------------------------------------------------------
select case when to_regclass('realtime.messages_' || to_char(now() at time zone 'utc', 'YYYY_MM_DD')) is not null
            then 'true' else 'false' end as has_partition \gset

\if :has_partition
select 'rt-probe:' || gen_random_uuid() as probe_topic \gset
select lives_ok(format($$ select private.broadcast(%L, 'probe', '{"k": 1}') $$, :'probe_topic'),
  'private.broadcast runs');
select results_eq(
  format($$ select event, payload ->> 'k', private, extension from realtime.messages where topic = %L $$, :'probe_topic'),
  $$ values ('probe'::text, '1'::text, true, 'broadcast'::text) $$,
  'private.broadcast sends a private broadcast message through realtime.send');

-- Probe messages, written as postgres (as the Realtime service and realtime.send do).
create table tests.rt_probe (id uuid primary key, label text not null);
grant select on tests.rt_probe to anon, authenticated;
with m as (
  insert into realtime.messages (topic, extension, event, payload, private)
  values ('user:' || :'e1_id', 'broadcast', 'probe', '{"label": "e1"}', true),
         ('user:' || :'e1_id', 'presence', 'probe', '{"label": "e1-presence"}', true),
         ('user:' || :'e2_id', 'broadcast', 'probe', '{"label": "e2"}', true),
         ('user:' || :'m_id', 'broadcast', 'probe', '{"label": "m"}', true),
         ('user:' || :'n_id', 'broadcast', 'probe', '{"label": "n"}', true),
         ('user:' || :'ne_id', 'broadcast', 'probe', '{"label": "ne"}', true),
         ('role:manager', 'broadcast', 'probe', '{"label": "managers"}', true),
         ('role:executor', 'broadcast', 'probe', '{"label": "executors"}', true)
  returning id, payload ->> 'label' as label
)
insert into tests.rt_probe select id, label from m;

select tests.authenticate_as(:'e1_id');
select set_eq($$ select p.label from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  $$ values ('e1') $$, 'executor reads only broadcast messages of his own user topic');
select set_config('realtime.topic', 'role:manager', true);
select set_eq($$ select p.label from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  $$ values ('e1') $$, 'the realtime.topic setting does not widen access (row topic decides)');
select set_config('realtime.topic', '', true);
select tests.authenticate_as(:'e2_id');
select set_eq($$ select p.label from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  $$ values ('e2') $$, 'another executor reads only his own user topic');
select tests.authenticate_as(:'m_id');
select set_eq($$ select p.label from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  $$ values ('m'), ('managers') $$, 'manager reads his user topic and role:manager');
-- No effective role (initial password not changed) -> no channel at all, not even the own one.
select tests.authenticate_as(:'n_id');
select is_empty($$ select 1 from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  'manager without an effective role reads nothing (neither his user topic nor role:manager)');
select tests.authenticate_as(:'ne_id');
select is_empty($$ select 1 from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  'executor without an effective role cannot read his own user topic');
select tests.clear_authentication();
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf')) where id = :'ne_id';
select tests.authenticate_as(:'ne_id');
select set_eq($$ select p.label from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  $$ values ('ne') $$, 'after the password change the same executor reads his own user topic');
select tests.authenticate_anon();
select is_empty($$ select 1 from realtime.messages r join tests.rt_probe p on p.id = r.id $$,
  'anon reads no messages');

-- Clients cannot send, change or delete messages.
select tests.authenticate_as(:'e1_id');
select throws_ok(
  format($$ insert into realtime.messages (topic, extension, event, payload, private)
            values (%L, 'broadcast', 'task', '{}', true) $$, 'user:' || :'e1_id'),
  '42501', null, 'authenticated cannot send to his own topic');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private)
     values ('role:manager', 'broadcast', 'task', '{}', true) $$,
  '42501', null, 'authenticated cannot send to role:manager');
select tests.authenticate_anon();
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private)
     values ('role:manager', 'broadcast', 'task', '{}', true) $$,
  '42501', null, 'anon cannot send');
select tests.authenticate_as(:'e1_id');
do $$
begin
  begin
    update realtime.messages set payload = '{"label": "forged"}' where id in (select id from tests.rt_probe);
  exception when insufficient_privilege then null;
  end;
  begin
    delete from realtime.messages where id in (select id from tests.rt_probe);
  exception when insufficient_privilege then null;
  end;
end;
$$;
select tests.clear_authentication();
select is((select count(*)::int from realtime.messages r join tests.rt_probe p on p.id = r.id
            where r.payload ->> 'label' = p.label), 8,
  'client update/delete attempts change no message');
\else
select skip('realtime.messages has no partition for today (Realtime service not started)', 14);
\endif

-- ---------------------------------------------------------------------------------------------
-- Recorder: from here on every hint is captured instead of being sent.
-- ---------------------------------------------------------------------------------------------
create table tests.broadcast_log (
  n bigint generated always as identity primary key,
  topic text not null,
  event text not null,
  payload jsonb not null
);
create or replace function private.broadcast(p_topic text, p_event text, p_payload jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into tests.broadcast_log (topic, event, payload) values (p_topic, p_event, p_payload);
$$;
create function tests.reset_broadcasts()
returns void
language sql
as $$
  delete from tests.broadcast_log;
$$;

-- Object created: only managers know about objects without tasks.
select tests.authenticate_as(:'m_id');
insert into public.objects (name, address) values ('rt-O', 'Addr') returning id as o_id \gset
insert into public.objects (name, address) values ('rt-O-empty', 'Addr') returning id as o_empty \gset
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  $$ values ('role:manager', 'object'), ('role:manager', 'object') $$,
  'object created: one object hint to role:manager per object, nobody else');
select set_eq($$ select payload from tests.broadcast_log $$,
  format($$ values (jsonb_build_object('id', %L::uuid)), (jsonb_build_object('id', %L::uuid)) $$, :'o_id', :'o_empty'),
  'object hint payload is exactly {id}');

-- Task created.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'rt-T1', :'e1_id') returning id as t1 \gset
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  format($$ values ('role:manager', 'task'), (%1$L, 'task'), (%1$L, 'notification') $$, 'user:' || :'e1_id'),
  'task created: task hint to managers and the assignee, notification hint to the assignee');
select is((select count(*)::int from tests.broadcast_log), 3, 'task created: exactly one message per topic and event');
select ok(coalesce((select bool_and(payload = jsonb_build_object('id', :'t1'::uuid, 'object_id', :'o_id'::uuid))
                      from tests.broadcast_log where event = 'task'), false),
  'task hint payload is exactly {id, object_id} (no title or other data)');
select results_eq(
  $$ select payload ->> 'op', (select array_agg(k order by k) from jsonb_object_keys(payload) k)
       from tests.broadcast_log where event = 'notification' $$,
  $$ values ('created'::text, array['ids', 'op']) $$,
  'notification hint payload is exactly {op: created, ids}');
select results_eq(
  $$ select array(select jsonb_array_elements_text(payload -> 'ids')::uuid)
       from tests.broadcast_log where event = 'notification' $$,
  format($$ select array(select id from public.notifications where task_id = %L and user_id = %L) $$, :'t1', :'e1_id'),
  'notification hint carries the id of the new notification');

-- Title edit: data hint, no notification.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
update public.tasks set title = 'rt-T1 edited' where id = :'t1';
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  format($$ values ('role:manager', 'task'), (%L, 'task') $$, 'user:' || :'e1_id'),
  'task edited: task hint to managers and the assignee, no notification');
select is((select count(*)::int from tests.broadcast_log), 2, 'task edited: two messages');

-- No-op updates (nothing changes, e.g. a bulk PATCH with the current values) send nothing.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
select results_eq(
  format($$ update public.tasks set title = title, description = description, assignee_id = assignee_id
             where id = %L returning id $$, :'t1'),
  format($$ values (%L::uuid) $$, :'t1'), 'a no-op task update (incl. the assignee) matches the row');
select results_eq(format($$ update public.objects set name = name, address = address where id = %L returning id $$, :'o_id'),
  format($$ values (%L::uuid) $$, :'o_id'), 'a no-op object update matches the row');
select tests.clear_authentication();
select is_empty($$ select topic, event from tests.broadcast_log $$, 'no-op task and object updates send no hints');

-- Reassignment E1 -> E2: the previous assignee must learn that the task is gone.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
update public.tasks set assignee_id = :'e2_id' where id = :'t1';
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  format($$ values ('role:manager', 'task'), (%1$L, 'task'), (%2$L, 'task'), (%1$L, 'notification'), (%2$L, 'notification') $$,
         'user:' || :'e1_id', 'user:' || :'e2_id'),
  'reassignment: task hint to managers, the new and the previous assignee; notification to both');
select is((select count(*)::int from tests.broadcast_log), 5, 'reassignment: five messages, no duplicates');

-- Status change by the assignee: task hint to managers and the assignee; the notification rows of
-- all managers are announced by ONE role:manager message without ids (each manager re-reads his
-- own rows under RLS), so the number of messages does not grow with the number of managers.
select tests.reset_broadcasts();
select tests.authenticate_as(:'e2_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t1'), 'E2 takes T1 into work');
select tests.clear_authentication();
select set_eq($$ select topic from tests.broadcast_log where event = 'task' $$,
  format($$ values ('role:manager'), (%L) $$, 'user:' || :'e2_id'),
  'status change: task hint to managers and the assignee');
select results_eq($$ select topic, payload from tests.broadcast_log where event = 'notification' $$,
  $$ values ('role:manager'::text, '{"op": "created"}'::jsonb) $$,
  'status change: one role:manager notification hint {op: created} without ids, none per manager');
select is((select count(*)::int from tests.broadcast_log where event = 'task'), 2,
  'status change: the history row adds no extra task hint');
select is((select count(*)::int from tests.broadcast_log), 3,
  'status change: three messages in total, independent of the number of managers');

-- Rejected and no-op requests send nothing.
select tests.reset_broadcasts();
select tests.authenticate_as(:'e1_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t1'),
  'P0001', 'task_not_found', 'the previous assignee cannot move the task');
select tests.authenticate_as(:'e2_id');
select throws_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'t1'),
  'P0001', 'transition_not_allowed', 'the executor cannot accept');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t1'),
  'P0001', 'transition_not_allowed', 'a repeated transition is rejected');
select throws_ok(
  format($$ insert into public.tasks (object_id, title, assignee_id) values (%L, 'rt-forged', %L) $$, :'o_id', :'e2_id'),
  '42501', null, 'the executor cannot create a task');
select is_empty(format($$ update public.tasks set title = 'rt-forged' where id = %L returning id $$, :'t1'),
  'the executor cannot edit the task (0 rows)');
select tests.authenticate_as(:'n_id');
select throws_ok(format($$ select public.delete_task(%L) $$, :'t1'),
  'P0001', 'task_not_found', 'a manager without an effective role cannot delete the task');
select tests.clear_authentication();
select is_empty($$ select topic, event from tests.broadcast_log $$,
  'rejected or no-op requests send no hints');

-- Atomicity: hints are written in the same transaction as the change.
select tests.authenticate_as(:'e2_id');
select throws_ok(
  format($f$ do $b$ begin perform public.change_task_status(%L, 'in_review'); raise exception 'rt_abort'; end $b$ $f$, :'t1'),
  'P0001', 'rt_abort', 'a transition followed by an error in the same transaction');
select tests.clear_authentication();
select is_empty($$ select topic, event from tests.broadcast_log $$, 'a rolled back transition sends no hints');
select is((select status::text from public.tasks where id = :'t1'), 'in_progress', 'and the status is unchanged');

-- Object edited: managers and the assignees of its active tasks (each once), not the assignee
-- of a deleted task.
select tests.authenticate_as(:'m_id');
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'rt-T2', :'e3_id') returning id as t2 \gset
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'rt-T3', :'e1_id') returning id as t3 \gset
insert into public.tasks (object_id, title, assignee_id) values (:'o_id', 'rt-T4', :'e1_id') returning id as t4 \gset
select lives_ok(format($$ select public.delete_task(%L) $$, :'t2'), 'manager deletes T2 (E3)');
select tests.clear_authentication();
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
update public.objects set name = 'rt-O edited' where id = :'o_id';
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  format($$ values ('role:manager', 'object'), (%L, 'object'), (%L, 'object') $$, 'user:' || :'e1_id', 'user:' || :'e2_id'),
  'object edited: hint to managers and to each assignee of an active task, not to E3 (deleted task)');
select is((select count(*)::int from tests.broadcast_log), 3, 'object edited: one hint per recipient');

-- Task deleted: the assignee loses it (task hint) and is notified.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
select lives_ok(format($$ select public.delete_task(%L) $$, :'t3'), 'manager deletes T3 (E1)');
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$,
  format($$ values ('role:manager', 'task'), (%1$L, 'task'), (%1$L, 'notification') $$, 'user:' || :'e1_id'),
  'task deleted: task hint to managers and the assignee, notification hint to the assignee');

-- Object deleted (no active tasks): managers only.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
select lives_ok(format($$ select public.delete_object(%L) $$, :'o_empty'), 'manager deletes the empty object');
select tests.clear_authentication();
select set_eq($$ select topic, event from tests.broadcast_log $$, $$ values ('role:manager', 'object') $$,
  'object deleted: object hint to managers only');

-- Review decision: the assignee gets a new notification; every manager's pending "in review"
-- notification is silently resolved, which is announced once to role:manager as op "updated".
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'t4'), 'E1 takes T4 into work');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'t4'), 'E1 sends T4 to review');
select tests.clear_authentication();
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
select lives_ok(format($$ select public.change_task_status(%L, 'rework', 'Fix it') $$, :'t4'), 'M returns T4 to rework');
select tests.clear_authentication();
select bag_eq($$ select topic, payload ->> 'op' from tests.broadcast_log where event = 'notification' $$,
  format($$ values (%L, 'created'), ('role:manager', 'updated') $$, 'user:' || :'e1_id'),
  'review decision: created to the assignee, one updated (silent resolution) to role:manager');
select results_eq(
  format($$ select array(select jsonb_array_elements_text(payload -> 'ids')::uuid) from tests.broadcast_log
             where event = 'notification' and topic = %L $$, 'user:' || :'e1_id'),
  format($$ select array(select id from public.notifications where task_id = %L and kind = 'task_rework') $$, :'t4'),
  'the assignee hint lists his new notification');
select is((select payload from tests.broadcast_log where event = 'notification' and topic = 'role:manager'),
  '{"op": "updated"}'::jsonb, 'the role:manager hint carries no ids');

-- Marking as read is announced to the reader's own topic only; a repeat changes nothing.
select id as n_rework from public.notifications where task_id = :'t4' and user_id = :'e1_id' and kind = 'task_rework' \gset
select tests.reset_broadcasts();
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.mark_notifications_read(array[%L::uuid]) $$, :'n_rework'), 'E1 marks the rework notification read');
select tests.clear_authentication();
select results_eq($$ select topic, event, payload from tests.broadcast_log $$,
  format($$ values (%L, 'notification', jsonb_build_object('op', 'updated', 'ids', jsonb_build_array(%L::uuid))) $$,
         'user:' || :'e1_id', :'n_rework'),
  'mark read: one updated hint to the reader with the marked id');
select tests.reset_broadcasts();
select tests.authenticate_as(:'e1_id');
select lives_ok(format($$ select public.mark_notifications_read(array[%L::uuid]) $$, :'n_rework'), 'E1 repeats the request');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'E1 marks all read');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'E1 repeats mark all');
select tests.clear_authentication();
select is((select count(*)::int from tests.broadcast_log where payload -> 'ids' ? :'n_rework'), 0,
  'a repeated mark sends nothing for an already read notification');
select is((select count(*)::int from tests.broadcast_log), 1,
  'mark all: one hint for the remaining unread notifications, nothing for the repeat');

-- A manager marking his (in progress / in review) notifications read: one role:manager message.
select tests.reset_broadcasts();
select tests.authenticate_as(:'m_id');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'M marks all read');
select tests.clear_authentication();
select results_eq($$ select topic, event, payload from tests.broadcast_log $$,
  $$ values ('role:manager'::text, 'notification'::text, '{"op": "updated"}'::jsonb) $$,
  'manager mark all: one role:manager updated hint, nothing on user:<manager>');

-- One statement mixing manager kinds and personal kinds sends both kinds of hints.
select tests.reset_broadcasts();
insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot)
values (:'m_id', 'task_in_review', :'t1', :'e2_id', 'rt-mixed'),
       (:'n_id', 'task_in_progress', :'t1', :'e2_id', 'rt-mixed'),
       (:'e1_id', 'task_assigned', :'t1', :'m_id', 'rt-mixed'),
       (:'e2_id', 'task_assigned', :'t1', :'m_id', 'rt-mixed');
select bag_eq($$ select topic, payload ->> 'op' as op, payload ? 'ids' as has_ids
                   from tests.broadcast_log where event = 'notification' $$,
  format($$ values ('role:manager', 'created', false), (%L, 'created', true), (%L, 'created', true) $$,
         'user:' || :'e1_id', 'user:' || :'e2_id'),
  'mixed statement: one role:manager hint without ids and one personal hint per executor');

-- A statement that touches no notification sends nothing.
select tests.reset_broadcasts();
update public.notifications set read_at = now() where false;
select is_empty($$ select 1 from tests.broadcast_log $$, 'a statement without affected rows sends no hint');

select * from finish();
rollback;
