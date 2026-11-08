-- Notification hints for managers: one message per statement instead of one per manager.
-- task_in_progress / task_in_review rows are created (and resolved) for every manager at once, so
-- a per-user hint would cost one Realtime message per manager per event and runs into the
-- Realtime rate limit (messages beyond it are dropped). Those rows are announced by ONE message
-- to role:manager without ids; each manager re-reads his own rows under RLS. All other kinds go
-- to a single user, so they keep the per-user hint user:<uid> with ids (at most 200 per message).
-- A statement without affected rows sends nothing.
create or replace function private.notifications_broadcast()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_op text := case tg_op when 'INSERT' then 'created' else 'updated' end;
  v_user_id uuid;
  v_ids uuid[];
begin
  if exists (select 1 from new_rows r where r.kind in ('task_in_progress', 'task_in_review')) then
    perform private.broadcast('role:manager', 'notification', jsonb_build_object('op', v_op));
  end if;

  for v_user_id, v_ids in
    select c.user_id, array_agg(c.id order by c.id)
      from (select r.user_id, r.id, (row_number() over (partition by r.user_id order by r.id) - 1) / 200 as chunk
              from new_rows r
             where r.kind not in ('task_in_progress', 'task_in_review')) as c
     group by c.user_id, c.chunk
  loop
    perform private.broadcast('user:' || v_user_id, 'notification',
                              jsonb_build_object('op', v_op, 'ids', to_jsonb(v_ids)));
  end loop;
  return null;
end;
$$;
