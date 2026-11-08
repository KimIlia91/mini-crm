-- Realtime hints only for real changes. The broadcast triggers fired on every updated row, even
-- when nothing changed, so a bulk PATCH with the current values could exhaust the Realtime
-- per-second limit (messages beyond it are dropped). The update case now has its own trigger with
-- a WHEN condition (an INSERT trigger cannot reference OLD, hence one trigger per event). The
-- trigger functions are unchanged.
-- private.tasks_notify needs no change: it fires only for assignee_id/deleted_at and writes a
-- notification only when the assignee or the deletion state actually changes.
drop trigger tasks_broadcast on public.tasks;
create trigger tasks_broadcast_insert
  after insert on public.tasks
  for each row execute function private.tasks_broadcast();
create trigger tasks_broadcast_update
  after update on public.tasks
  for each row
  when (old.* is distinct from new.*)
  execute function private.tasks_broadcast();

drop trigger objects_broadcast on public.objects;
create trigger objects_broadcast_insert
  after insert on public.objects
  for each row execute function private.objects_broadcast();
create trigger objects_broadcast_update
  after update on public.objects
  for each row
  when (old.* is distinct from new.*)
  execute function private.objects_broadcast();
