-- Realtime channels follow the baseline "no effective role -> no access": a user who has not
-- changed the initial password cannot join any channel, not even his own user:<uid> (until now he
-- could receive ids-only hints there). Same policy name; only the user: branch gains the role check.
drop policy realtime_messages_select_own_topics on realtime.messages;
create policy realtime_messages_select_own_topics on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (
      (topic = 'user:' || (select auth.uid())::text and (select private.current_app_role()) is not null)
      or (topic = 'role:manager' and (select private.current_app_role()) = 'manager')
    )
  );
