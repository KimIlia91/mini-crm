-- Realtime hints. After every insert/update of a task or an object the database sends an ids-only
-- hint to private broadcast channels; clients then re-read the data with their own RLS. Hints
-- never carry data, so a hint that reaches a client cannot leak anything.
--
-- Postgres Changes are NOT used and no table is added to the supabase_realtime publication: their
-- RLS check sees only the new row version, so a previous assignee (reassignment) or anyone after a
-- soft delete would never learn that a row is gone.
--
-- Topics:
--   user:<uid>    readable by that user only;
--   role:manager  readable by managers with an effective role (see private.current_app_role).
-- Clients cannot send: realtime.messages gets a SELECT policy only (no INSERT/UPDATE/DELETE).
--
-- realtime.send writes to realtime.messages in the same transaction (a rollback sends nothing) and
-- never raises (it only warns, e.g. when the daily partition does not exist yet), so a lost hint
-- never aborts the business change. Clients resynchronise after reconnects anyway.

-- Single sending point for every hint (tests replace it with a recorder). Not executable by
-- clients (no grant); called from the SECURITY DEFINER triggers below.
create function private.broadcast(p_topic text, p_event text, p_payload jsonb)
returns void
language sql
set search_path = ''
as $$
  select realtime.send(p_payload, p_event, p_topic, true);
$$;

-- Tasks: managers, the assignee and, after a reassignment, the previous assignee.
-- SECURITY DEFINER: the trigger fires for the client role (e.g. a manager's UPDATE through the
-- Data API), which has no INSERT policy on realtime.messages by design.
create function private.tasks_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('id', new.id, 'object_id', new.object_id);
begin
  perform private.broadcast('role:manager', 'task', v_payload);
  perform private.broadcast('user:' || new.assignee_id, 'task', v_payload);
  if tg_op = 'UPDATE' and old.assignee_id is distinct from new.assignee_id then
    perform private.broadcast('user:' || old.assignee_id, 'task', v_payload);
  end if;
  return null;
end;
$$;

create trigger tasks_broadcast
  after insert or update on public.tasks
  for each row execute function private.tasks_broadcast();

-- Objects: managers and every assignee of an active task in the object (once each). Executors
-- see an object only through their active tasks, so nobody else can have it on screen.
create function private.objects_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object('id', new.id);
  v_assignee uuid;
begin
  perform private.broadcast('role:manager', 'object', v_payload);
  for v_assignee in
    select distinct t.assignee_id from public.tasks t where t.object_id = new.id and t.deleted_at is null
  loop
    perform private.broadcast('user:' || v_assignee, 'object', v_payload);
  end loop;
  return null;
end;
$$;

create trigger objects_broadcast
  after insert or update on public.objects
  for each row execute function private.objects_broadcast();

-- Channel authorization. Realtime checks it by selecting the channel's message rows as the
-- subscriber, so the row topic decides (the realtime.topic setting cannot widen access).
create policy realtime_messages_select_own_topics on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (
      topic = 'user:' || (select auth.uid())::text
      or (topic = 'role:manager' and (select private.current_app_role()) = 'manager')
    )
  );
