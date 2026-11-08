-- In-app notifications. Rows are written ONLY by the triggers below, in the same transaction as
-- the event (a rejected or rolled back change leaves no notification), and never to the actor.
-- Clients read their own rows (RLS) and mark them read through the RPCs; nothing else is writable.
--
-- Events:
--   task created / reassigned / deleted  -> assignee: task_assigned / task_unassigned (previous
--                                           assignee) / task_deleted
--   taken into work, sent to review      -> every manager: task_in_progress / task_in_review
--   returned to rework, accepted         -> assignee: task_rework (with the comment) / task_accepted
-- A review decision (or the deletion of the task) silently resolves every pending task_in_review
-- of the task: it becomes read and gets resolved_at/resolved_by/resolution, without a new
-- notification. Editing the title/description notifies nobody.
-- Each insert/update is announced to the recipient's realtime topic user:<uid> as an ids-only
-- hint ({op: created|updated, ids}).

create type public.notification_kind as enum (
  'task_assigned', 'task_unassigned', 'task_deleted', 'task_rework', 'task_accepted',
  'task_in_progress', 'task_in_review'
);

-- Text rule as in crm_core: lengths are measured after trimming ASCII whitespace.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    constraint notifications_user_id_fkey references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  task_id uuid not null
    constraint notifications_task_id_fkey references public.tasks (id) on delete cascade,
  actor_id uuid constraint notifications_actor_id_fkey references public.profiles (id) on delete set null,
  -- The title at the time of the event (the recipient may no longer see the task).
  title_snapshot text not null constraint notifications_title_snapshot_check
    check (char_length(btrim(title_snapshot, E' \t\n\r\f\x0b')) between 1 and 200),
  comment text constraint notifications_comment_check
    check (comment is null or char_length(btrim(comment, E' \t\n\r\f\x0b')) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid constraint notifications_resolved_by_fkey references public.profiles (id) on delete set null,
  resolution text constraint notifications_resolution_check check (resolution in ('accepted', 'rework', 'deleted')),
  -- The rework comment is the only comment, and a rework always has one.
  constraint notifications_comment_kind_check check ((comment is not null) = (kind = 'task_rework')),
  constraint notifications_resolved_check check ((resolved_at is null) = (resolution is null)),
  constraint notifications_resolved_by_check check (resolved_at is not null or resolved_by is null),
  constraint notifications_resolution_kind_check check (resolved_at is null or kind = 'task_in_review'),
  constraint notifications_resolved_read_check check (resolved_at is null or read_at is not null)
);
-- The list (newest first, id as the keyset tie-breaker; also covers the user_id FK), the unread
-- counter, pending reviews of a task (resolution), the other FKs and the retention purge.
create index notifications_user_id_created_at_id_idx on public.notifications (user_id, created_at desc, id desc);
create index notifications_unread_user_id_idx on public.notifications (user_id) where read_at is null;
create index notifications_pending_review_task_id_idx on public.notifications (task_id)
  where kind = 'task_in_review' and resolved_at is null;
create index notifications_task_id_idx on public.notifications (task_id);
create index notifications_actor_id_idx on public.notifications (actor_id);
create index notifications_resolved_by_idx on public.notifications (resolved_by);
create index notifications_created_at_idx on public.notifications (created_at);

-- Privileges and RLS: select only. A user without an effective role (initial password not
-- changed) sees nothing, as with all other CRM data.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.current_app_role()) is not null);

-- ---------------------------------------------------------------------------------------------
-- Writers (SECURITY DEFINER: they fire for the client role, which cannot write notifications).
-- Resolving a pending review keeps an earlier read_at.
-- ---------------------------------------------------------------------------------------------

-- Task created, reassigned or soft-deleted. The actor is the author (insert), the deleter (soft
-- delete) or the caller (reassignment; null for admin SQL).
create function private.tasks_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null and new.assignee_id is distinct from new.author_id then
      insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot)
      values (new.assignee_id, 'task_assigned', new.id, new.author_id, new.title);
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    if new.assignee_id is distinct from new.deleted_by then
      insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot)
      values (new.assignee_id, 'task_deleted', new.id, new.deleted_by, new.title);
    end if;
    update public.notifications n
       set read_at = coalesce(n.read_at, now()), resolved_at = now(), resolved_by = new.deleted_by,
           resolution = 'deleted'
     where n.task_id = new.id and n.kind = 'task_in_review' and n.resolved_at is null;
  elsif new.deleted_at is null and old.assignee_id is distinct from new.assignee_id then
    v_actor := (select auth.uid());
    insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot)
    select r.user_id, r.kind, new.id, v_actor, new.title
      from (values (new.assignee_id, 'task_assigned'::public.notification_kind),
                   (old.assignee_id, 'task_unassigned'::public.notification_kind)) as r (user_id, kind)
     where r.user_id is distinct from v_actor;
  end if;
  return null;
end;
$$;

create trigger tasks_notify
  after insert or update of assignee_id, deleted_at on public.tasks
  for each row execute function private.tasks_notify();

-- Status changes (the creation row, from_status null, is excluded by the trigger condition).
create function private.history_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
  v_title text;
begin
  select t.assignee_id, t.title into v_assignee, v_title from public.tasks t where t.id = new.task_id;

  if new.to_status in ('in_progress', 'in_review') then
    insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot)
    select p.id,
           case new.to_status when 'in_progress' then 'task_in_progress'::public.notification_kind
                              else 'task_in_review'::public.notification_kind end,
           new.task_id, new.changed_by, v_title
      from public.profiles p
     where p.role = 'manager' and p.id <> new.changed_by;
  elsif new.to_status in ('rework', 'accepted') then
    if v_assignee <> new.changed_by then
      insert into public.notifications (user_id, kind, task_id, actor_id, title_snapshot, comment)
      values (v_assignee,
              case new.to_status when 'rework' then 'task_rework'::public.notification_kind
                                 else 'task_accepted'::public.notification_kind end,
              new.task_id, new.changed_by, v_title,
              case when new.to_status = 'rework' then new.comment end);
    end if;
    update public.notifications n
       set read_at = coalesce(n.read_at, now()), resolved_at = now(), resolved_by = new.changed_by,
           resolution = new.to_status::text
     where n.task_id = new.task_id and n.kind = 'task_in_review' and n.resolved_at is null;
  end if;
  return null;
end;
$$;

create trigger history_notify
  after insert on public.task_status_history
  for each row
  when (new.from_status is not null)
  execute function private.history_notify();

-- Realtime hint per recipient and statement: {op: created|updated, ids} (at most 200 ids per
-- message, the limit of mark_notifications_read). SECURITY INVOKER: notifications are written only
-- by the definer functions in this file (or admin SQL), which already run as the owner.
create function private.notifications_broadcast()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_op text := case tg_op when 'INSERT' then 'created' else 'updated' end;
  v_user_id uuid;
  v_ids uuid[];
begin
  for v_user_id, v_ids in
    select c.user_id, array_agg(c.id order by c.id)
      from (select r.user_id, r.id, (row_number() over (partition by r.user_id order by r.id) - 1) / 200 as chunk
              from new_rows r) as c
     group by c.user_id, c.chunk
  loop
    perform private.broadcast('user:' || v_user_id, 'notification',
                              jsonb_build_object('op', v_op, 'ids', to_jsonb(v_ids)));
  end loop;
  return null;
end;
$$;

create trigger notifications_broadcast_created
  after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function private.notifications_broadcast();
create trigger notifications_broadcast_updated
  after update on public.notifications
  referencing new table as new_rows
  for each statement execute function private.notifications_broadcast();

-- ---------------------------------------------------------------------------------------------
-- Read RPCs. Only read_at of the caller's own unread rows changes; foreign or unknown ids are
-- silently ignored (no existence oracle); repeats change nothing. A user without an effective role
-- cannot see notifications, so for him the calls are a no-op.
-- ---------------------------------------------------------------------------------------------
create function private.mark_notifications_read(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ids is null then
    raise exception 'ids_required' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'too_many_ids' using errcode = '22023';
  end if;
  if (select private.current_app_role()) is null then
    return;
  end if;

  update public.notifications n
     set read_at = now()
   where n.user_id = (select auth.uid()) and n.id = any (p_ids) and n.read_at is null;
end;
$$;
grant execute on function private.mark_notifications_read(uuid[]) to authenticated;

create function public.mark_notifications_read(p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_notifications_read(p_ids);
$$;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create function private.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.current_app_role()) is null then
    return;
  end if;

  update public.notifications n
     set read_at = now()
   where n.user_id = (select auth.uid()) and n.read_at is null;
end;
$$;
grant execute on function private.mark_all_notifications_read() to authenticated;

create function public.mark_all_notifications_read()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_all_notifications_read();
$$;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Retention: notifications older than 90 days are deleted daily by pg_cron (the job runs as
-- postgres; the function is not executable by clients).
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

create function private.purge_old_notifications()
returns integer
language sql
set search_path = ''
as $$
  with deleted as (
    delete from public.notifications where created_at < now() - interval '90 days' returning 1
  )
  select count(*)::integer from deleted;
$$;

select cron.schedule('purge-old-notifications', '17 3 * * *', 'select private.purge_old_notifications()');
