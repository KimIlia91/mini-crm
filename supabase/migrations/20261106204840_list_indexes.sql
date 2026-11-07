-- Server-side lists: sort key for task status and indexes for the paginated/board queries.

-- Workflow position of the status (tasks needing action first); the order must match the
-- client's status order. Generated, so clients can sort by it but never write it: the column
-- is not in any insert/update column grant, and Postgres rejects explicit values anyway.
alter table public.tasks
  add column status_rank smallint not null generated always as (
    case status
      when 'rework' then 0
      when 'new' then 1
      when 'in_progress' then 2
      when 'in_review' then 3
      when 'accepted' then 4
    end
  ) stored;

-- Board columns and filtered lists: scope (object or assignee) + status, newest first, with
-- id as the keyset tie-breaker. Only active rows are ever listed.
create index tasks_active_object_status_idx
  on public.tasks (object_id, status, created_at desc, id desc)
  where deleted_at is null;
create index tasks_active_assignee_status_idx
  on public.tasks (assignee_id, status, created_at desc, id desc)
  where deleted_at is null;

-- Objects list sorted by name (id breaks ties).
create index objects_active_name_idx
  on public.objects (name, id)
  where deleted_at is null;
