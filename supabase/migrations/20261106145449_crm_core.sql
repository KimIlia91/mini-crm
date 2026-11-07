-- CRM core: profiles, objects, tasks, status history, transition rules, RLS, grants and the
-- status-change API. Business rules and access control live here; clients only call the API.

-- ---------------------------------------------------------------------------------------------
-- Default privileges: the platform grants ALL on new public tables/sequences to anon and
-- authenticated. Revoke it, so every table privilege below is an explicit, reviewed grant.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types
create type public.app_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'in_review', 'accepted', 'rework');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- Text rule (one for all checks and normalisation): blank = only ASCII whitespace, trimmed with
-- btrim(x, E' \t\n\r\f\x0b') (space, tab, LF, CR, FF, VT); lengths are measured after trimming.
create table public.profiles (
  id uuid primary key constraint profiles_id_fkey references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null constraint profiles_full_name_check
    check (char_length(btrim(full_name, E' \t\n\r\f\x0b')) between 1 and 100),
  role public.app_role not null,
  -- Every new user must change the initial password before getting any access (see
  -- private.current_app_role). Cleared only by a real password change (trigger below).
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint objects_name_check check (char_length(btrim(name, E' \t\n\r\f\x0b')) between 1 and 200),
  address text not null constraint objects_address_check
    check (char_length(btrim(address, E' \t\n\r\f\x0b')) between 1 and 500),
  created_at timestamptz not null default now(),
  -- Soft delete: set only by public.delete_object (see "Soft delete" below).
  deleted_at timestamptz,
  deleted_by uuid constraint objects_deleted_by_fkey references public.profiles (id) on delete restrict,
  constraint objects_deleted_check check ((deleted_at is null) = (deleted_by is null))
);
create index objects_deleted_by_idx on public.objects (deleted_by);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null
    constraint tasks_object_id_fkey references public.objects (id) on delete restrict,
  title text not null constraint tasks_title_check check (char_length(btrim(title, E' \t\n\r\f\x0b')) between 1 and 200),
  description text not null default ''
    constraint tasks_description_check check (char_length(description) <= 5000),
  assignee_id uuid not null
    constraint tasks_assignee_id_fkey references public.profiles (id) on delete restrict,
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid()
    constraint tasks_author_id_fkey references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Soft delete: set only by public.delete_task (see "Soft delete" below).
  deleted_at timestamptz,
  deleted_by uuid constraint tasks_deleted_by_fkey references public.profiles (id) on delete restrict,
  constraint tasks_deleted_check check ((deleted_at is null) = (deleted_by is null))
);
create index tasks_assignee_id_idx on public.tasks (assignee_id);
create index tasks_object_id_assignee_id_idx on public.tasks (object_id, assignee_id);
create index tasks_author_id_idx on public.tasks (author_id);
create index tasks_deleted_by_idx on public.tasks (deleted_by);

create table public.task_status_history (
  id bigint generated always as identity primary key,
  -- Clients only soft-delete tasks, so history is kept; the cascade applies to an admin hard
  -- delete only.
  task_id uuid not null
    constraint task_status_history_task_id_fkey references public.tasks (id) on delete cascade,
  from_status public.task_status, -- null = task creation
  to_status public.task_status not null,
  changed_by uuid not null
    constraint task_status_history_changed_by_fkey references public.profiles (id) on delete restrict,
  comment text constraint task_status_history_comment_check
    check (comment is null or char_length(btrim(comment, E' \t\n\r\f\x0b')) between 1 and 1000),
  changed_at timestamptz not null default now(),
  constraint task_status_history_status_changed_check check (from_status is distinct from to_status),
  constraint task_status_history_rework_comment_check check (to_status <> 'rework' or comment is not null)
);
create index task_status_history_task_id_id_idx on public.task_status_history (task_id, id);
create index task_status_history_changed_by_idx on public.task_status_history (changed_by);

-- Single source of truth for allowed status transitions (read by the API and by the UI).
create table public.task_transitions (
  from_status public.task_status not null,
  to_status public.task_status not null,
  actor_role public.app_role not null,
  comment_required boolean not null default false,
  primary key (from_status, to_status),
  constraint task_transitions_distinct_check check (from_status <> to_status)
);
insert into public.task_transitions (from_status, to_status, actor_role, comment_required) values
  ('new', 'in_progress', 'executor', false),
  ('in_progress', 'in_review', 'executor', false),
  ('in_review', 'accepted', 'manager', false),
  ('in_review', 'rework', 'manager', true),
  ('rework', 'in_progress', 'executor', false);

-- ---------------------------------------------------------------------------------------------
-- Helpers (private, not exposed by the Data API)
-- Effective role of the caller: null until the initial password has been changed, so such a
-- user gets no access to objects, tasks or history (only their own profile).
create function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid()) and not p.must_change_password;
$$;
grant execute on function private.current_app_role() to authenticated;

-- The role comes only from app_metadata.app_role (writable by the service role / SQL only), never
-- from user-editable user_metadata. Missing -> executor; anything else -> error.
create function private.app_role_from_metadata(p_app_meta_data jsonb)
returns public.app_role
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text := coalesce(p_app_meta_data ->> 'app_role', 'executor');
begin
  if v_role not in ('manager', 'executor') then
    raise exception 'invalid_app_role' using errcode = '22023';
  end if;
  return v_role::public.app_role;
end;
$$;

-- Profile for every new auth user.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name', E' \t\n\r\f\x0b'), ''), split_part(new.email, '@', 1)),
    private.app_role_from_metadata(new.raw_app_meta_data)
  );
  return null;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- The Auth admin API (createUser / updateUserById) inserts the user first and writes the caller's
-- app_metadata in a following UPDATE of the same transaction, so the insert trigger alone would
-- never see app_role. Keep the profile role in sync whenever app_metadata.app_role changes.
create function private.handle_app_role_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set role = private.app_role_from_metadata(new.raw_app_meta_data)
   where id = new.id;
  return null;
end;
$$;

create trigger on_auth_user_app_role_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data ->> 'app_role' is distinct from new.raw_app_meta_data ->> 'app_role')
  execute function private.handle_app_role_changed();

-- A real password change (user or admin) clears the forced-change flag. There is no RPC for it:
-- the flag cannot be cleared without changing the password. Re-enabling it is an admin SQL task.
create function private.handle_password_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set must_change_password = false
   where id = new.id and must_change_password;
  return null;
end;
$$;

create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.handle_password_changed();

-- Assignee of an active task must be an executor (checked regardless of the caller's profile
-- visibility; also re-checked when an admin restores a task). `for share` serializes with a
-- concurrent role change of the same profile (see private.profiles_validate_role_change), so
-- neither side can miss the other.
create function private.tasks_validate_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- BEFORE triggers run before RLS WITH CHECK: deny non-managers first, so the errors below are
  -- not an existence oracle for them. The error is exactly the RLS denial of tasks_insert, so the
  -- answer is identical whatever the object/assignee. Admin SQL (no auth.uid()) is unaffected.
  if (select auth.uid()) is not null and (select private.current_app_role()) is distinct from 'manager' then
    raise exception using errcode = '42501', message = 'new row violates row-level security policy for table "tasks"';
  end if;
  if new.deleted_at is not null then
    return new;
  end if;
  perform 1 from public.profiles p
   where p.id = new.assignee_id and p.role = 'executor'
     for share;
  if not found then
    raise exception 'assignee_not_executor';
  end if;
  return new;
end;
$$;

create trigger tasks_validate_assignee
  before insert or update of assignee_id, deleted_at on public.tasks
  for each row execute function private.tasks_validate_assignee();

-- An active task must belong to an active object (insert, and an admin restore). `for share`
-- waits for a concurrent private.delete_object (which holds `for update` on the object) and then
-- re-checks the committed row, so a task can never be created in an object being deleted.
create function private.tasks_validate_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same guard as private.tasks_validate_assignee (no existence oracle for non-managers).
  if (select auth.uid()) is not null and (select private.current_app_role()) is distinct from 'manager' then
    raise exception using errcode = '42501', message = 'new row violates row-level security policy for table "tasks"';
  end if;
  if new.deleted_at is not null then
    return new;
  end if;
  perform 1 from public.objects o
   where o.id = new.object_id and o.deleted_at is null
     for share;
  if not found then
    raise exception 'object_not_found';
  end if;
  return new;
end;
$$;

create trigger tasks_validate_object
  before insert or update of object_id, deleted_at on public.tasks
  for each row execute function private.tasks_validate_object();

-- The other half of "assignee is an executor": an executor who is the assignee of any active
-- task cannot get another role (direct SQL or the app_metadata sync). Reassign the tasks first.
create function private.profiles_validate_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'executor' and new.role <> 'executor'
     and exists (select 1 from public.tasks t where t.assignee_id = new.id and t.deleted_at is null) then
    raise exception 'assignee_has_tasks';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_role_change
  before update of role on public.profiles
  for each row execute function private.profiles_validate_role_change();

-- The first history row (creation) is written by the database, never by the client.
create function private.tasks_write_initial_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (new.id, null, new.status, new.author_id);
  return null;
end;
$$;

create trigger tasks_write_initial_history
  after insert on public.tasks
  for each row execute function private.tasks_write_initial_history();

-- ---------------------------------------------------------------------------------------------
-- Status change: rule check, status update and history row in one transaction. The task row
-- is locked (for update), so concurrent requests are serialized and the second one sees the
-- new status (-> transition_not_allowed). Foreign, missing and deleted tasks are
-- indistinguishable; a concurrent private.delete_task is serialized by the same row lock.
create function private.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.app_role;
  v_status public.task_status;
  v_assignee uuid;
  v_comment text := nullif(btrim(p_comment, E' \t\n\r\f\x0b'), '');
  v_comment_required boolean;
begin
  -- No effective role (no profile or password not changed yet): the user sees no tasks, so the
  -- task is "not found". Checked before touching the task (no existence oracle, no lock).
  v_role := (select private.current_app_role());
  if v_role is null then
    raise exception 'task_not_found';
  end if;

  select t.status, t.assignee_id into v_status, v_assignee
    from public.tasks t
   where t.id = p_task_id and t.deleted_at is null
     for update;

  if not found or (v_role = 'executor' and v_assignee <> v_uid) then
    raise exception 'task_not_found';
  end if;

  select r.comment_required into v_comment_required
    from public.task_transitions r
   where r.from_status = v_status and r.to_status = p_to_status and r.actor_role = v_role;

  if not found then
    raise exception 'transition_not_allowed';
  end if;

  if v_comment_required and v_comment is null then
    raise exception 'comment_required';
  end if;

  update public.tasks set status = p_to_status where id = p_task_id;

  insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
  values (p_task_id, v_status, p_to_status, v_uid, v_comment);
end;
$$;
grant execute on function private.change_task_status(uuid, public.task_status, text) to authenticated;

-- Public RPC: a thin SECURITY INVOKER wrapper (no SECURITY DEFINER in exposed schemas).
create function public.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.change_task_status(p_task_id, p_to_status, p_comment);
$$;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Soft delete. Clients cannot DELETE tasks/objects nor write deleted_at/deleted_by; the only way
-- is these RPCs (managers only). Deleted rows and the history of deleted tasks are invisible to
-- every client (RLS) but stay in the database. There is no restore API; restore is an admin SQL
-- task (the validation triggers re-check that the object is active and the assignee is an
-- executor):
--   update public.objects set deleted_at = null, deleted_by = null where id = '<object id>';
--   update public.tasks   set deleted_at = null, deleted_by = null where id = '<task id>';
-- Hard delete (postgres only) still cascades a task's history.

-- Missing, foreign-role and already deleted tasks are all `task_not_found` (idempotent repeat).
-- `for update` serializes with private.change_task_status on the same row.
create function private.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.current_app_role()) is distinct from 'manager' then
    raise exception 'task_not_found';
  end if;

  perform 1 from public.tasks t
   where t.id = p_task_id and t.deleted_at is null
     for update;
  if not found then
    raise exception 'task_not_found';
  end if;

  update public.tasks set deleted_at = now(), deleted_by = (select auth.uid()) where id = p_task_id;
end;
$$;
grant execute on function private.delete_task(uuid) to authenticated;

create function public.delete_task(p_task_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_task(p_task_id);
$$;
grant execute on function public.delete_task(uuid) to authenticated;

-- An object can be deleted only without active tasks. `for update` on the object blocks a
-- concurrent task insert (private.tasks_validate_object takes `for share`); the active-task
-- check runs after the lock, on committed data.
create function private.delete_object(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.current_app_role()) is distinct from 'manager' then
    raise exception 'object_not_found';
  end if;

  perform 1 from public.objects o
   where o.id = p_object_id and o.deleted_at is null
     for update;
  if not found then
    raise exception 'object_not_found';
  end if;

  if exists (select 1 from public.tasks t where t.object_id = p_object_id and t.deleted_at is null) then
    raise exception 'object_has_tasks';
  end if;

  update public.objects set deleted_at = now(), deleted_by = (select auth.uid()) where id = p_object_id;
end;
$$;
grant execute on function private.delete_object(uuid) to authenticated;

create function public.delete_object(p_object_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_object(p_object_id);
$$;
grant execute on function public.delete_object(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Privileges: nothing by default, then the minimum per table. Columns that carry rights or
-- workflow state (id, status, author_id, created_at, object_id on update, deleted_at,
-- deleted_by) are not writable. No DELETE: tasks and objects are soft-deleted via the RPCs.
revoke all on public.profiles, public.objects, public.tasks, public.task_status_history,
  public.task_transitions from anon, authenticated;
revoke all on sequence public.task_status_history_id_seq from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.objects to authenticated;
grant insert (name, address), update (name, address) on public.objects to authenticated;
grant select on public.tasks to authenticated;
grant insert (object_id, title, description, assignee_id) on public.tasks to authenticated;
grant update (title, description, assignee_id) on public.tasks to authenticated;
grant select on public.task_status_history to authenticated;
grant select on public.task_transitions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security. `(select private.current_app_role())` is evaluated once per statement:
-- 'manager' / 'executor' only after the initial password change, otherwise null (no access).
alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;
alter table public.task_transitions enable row level security;

-- profiles: own profile always (the UI reads must_change_password); managers see everyone;
-- executors see managers (task authors) and people who changed the status of their tasks.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.current_app_role()) = 'manager'
    or (
      (select private.current_app_role()) = 'executor'
      and (
        role = 'manager'
        or exists (
          select 1
            from public.task_status_history h
            join public.tasks t on t.id = h.task_id
           where h.changed_by = profiles.id
        )
      )
    )
  );

-- objects: deleted ones are invisible to everyone; managers see all active objects; executors
-- see active objects where they have an active task.
create policy objects_select on public.objects
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select private.current_app_role()) = 'manager'
      or (
        (select private.current_app_role()) = 'executor'
        and exists (
          select 1 from public.tasks t
           where t.object_id = objects.id and t.assignee_id = (select auth.uid())
             and t.deleted_at is null
        )
      )
    )
  );
create policy objects_insert on public.objects
  for insert to authenticated
  with check ((select private.current_app_role()) = 'manager');
create policy objects_update on public.objects
  for update to authenticated
  using ((select private.current_app_role()) = 'manager' and deleted_at is null)
  with check ((select private.current_app_role()) = 'manager');

-- tasks: deleted ones are invisible to everyone; managers see all active tasks; executors only
-- their own. Accepted and deleted tasks are read-only.
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select private.current_app_role()) = 'manager'
      or ((select private.current_app_role()) = 'executor' and assignee_id = (select auth.uid()))
    )
  );
-- "The object exists and is active" is enforced by the trigger private.tasks_validate_object
-- (race-safe, `object_not_found`), not here: a subquery on objects would recurse through
-- objects_select, which reads tasks.
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check ((select private.current_app_role()) = 'manager' and author_id = (select auth.uid()));
create policy tasks_update on public.tasks
  for update to authenticated
  using ((select private.current_app_role()) = 'manager' and status <> 'accepted' and deleted_at is null)
  with check ((select private.current_app_role()) = 'manager');

-- history: readable together with the task (tasks RLS applies inside the subquery, so the
-- history of a deleted task is invisible too).
create policy task_status_history_select on public.task_status_history
  for select to authenticated
  using (
    (select private.current_app_role()) is not null
    and exists (select 1 from public.tasks t where t.id = task_status_history.task_id)
  );

-- Transition rules are not sensitive: the UI derives available actions from them.
create policy task_transitions_select on public.task_transitions
  for select to authenticated
  using (true);
