-- GraphQL path to notifications. pg_graphql is not enabled in the local stack (the endpoint
-- answers "pg_graphql extension is not enabled"), but hosted projects usually have it, so it is
-- enabled here inside the test transaction (rolled back) and queried as real client roles: the
-- same grants and RLS must apply as for REST — only own rows, nothing without an effective role,
-- nothing for anon, no table writes; the read RPCs (exposed as mutations) ignore foreign ids.
-- pg_graphql names are not inflected: notificationsCollection, user_id, updatenotificationsCollection.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(17);

select tests.create_user('gq-m-' || gen_random_uuid() || '@example.test') as m_id \gset
select tests.create_user('gq-e1-' || gen_random_uuid() || '@example.test') as e1_id \gset
select tests.create_user('gq-e2-' || gen_random_uuid() || '@example.test') as e2_id \gset
select tests.create_user('gq-en-' || gen_random_uuid() || '@example.test') as en_id \gset
update public.profiles set role = 'manager' where id = :'m_id';
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'m_id', :'e1_id', :'e2_id');

insert into public.objects (name, address) values ('gq-O', 'Addr') returning id as o_id \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'o_id', 'gq-T1', :'e1_id', :'m_id') returning id as t1 \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'o_id', 'gq-T2', :'e2_id', :'m_id') returning id as t2 \gset
insert into public.tasks (object_id, title, assignee_id, author_id)
values (:'o_id', 'gq-T3', :'en_id', :'m_id') returning id as t3 \gset
select id as n_e1 from public.notifications where task_id = :'t1' and user_id = :'e1_id' \gset
select id as n_e2 from public.notifications where task_id = :'t2' and user_id = :'e2_id' \gset

select lives_ok($$ create extension if not exists pg_graphql $$, 'pg_graphql can be enabled (as in hosted projects)');

-- user_id of every notification node returned by a notificationsCollection query.
create function tests.gql_user_ids(p_query text)
returns jsonb
language sql
as $$
  select coalesce(jsonb_path_query_array(graphql.resolve(p_query),
                                         '$.data.notificationsCollection.edges[*].node.user_id'), '[]');
$$;
grant execute on function tests.gql_user_ids(text) to anon, authenticated;

-- Queries: own rows only.
select tests.authenticate_as(:'e1_id');
select is(tests.gql_user_ids('{ notificationsCollection(first: 30) { edges { node { id user_id } } } }'),
  jsonb_build_array(:'e1_id'::text), 'E1: GraphQL returns exactly his own notification');
select is(tests.gql_user_ids(format('{ notificationsCollection(filter: { user_id: { eq: "%s" } }) { edges { node { id user_id } } } }', :'e2_id')),
  '[]'::jsonb, 'E1: filtering by E2''s user id returns nothing');
select is(tests.gql_user_ids(format('{ notificationsCollection(filter: { id: { eq: "%s" } }) { edges { node { id user_id } } } }', :'n_e2')),
  '[]'::jsonb, 'E1: filtering by E2''s notification id returns nothing');
select is(
  jsonb_path_query_array(graphql.resolve('{ tasksCollection { edges { node { id notificationsCollection { edges { node { user_id } } } } } } }'),
                         '$.data.tasksCollection.edges[*].node.notificationsCollection.edges[*].node.user_id'),
  jsonb_build_array(:'e1_id'::text), 'E1: notifications embedded in tasks are only his own');

-- Table mutations are not in the schema (no INSERT/UPDATE/DELETE privilege); positive control:
-- tasks, where authenticated has column UPDATE, does get an update mutation.
select is(graphql.resolve($q$ mutation { updatetasksCollection(set: { title: "x" },
            filter: { id: { eq: "00000000-0000-0000-0000-000000000000" } }) { affectedCount } } $q$),
  '{"data": {"updatetasksCollection": {"affectedCount": 0}}}'::jsonb,
  'control: a granted table write is exposed as a mutation');
select matches(graphql.resolve(format($q$ mutation { updatenotificationsCollection(set: { read_at: "2026-01-01T00:00:00Z" },
                 filter: { id: { eq: "%s" } }) { affectedCount } } $q$, :'n_e1')) #>> '{errors,0,message}',
  'Unknown field', 'E1: no GraphQL update mutation for notifications');
select matches(graphql.resolve(format($q$ mutation { deleteFromnotificationsCollection(filter: { id: { eq: "%s" } }) { affectedCount } } $q$, :'n_e1'))
                 #>> '{errors,0,message}',
  'Unknown field', 'E1: no GraphQL delete mutation for notifications');
select matches(graphql.resolve(format($q$ mutation { insertIntonotificationsCollection(objects: [{ user_id: "%s", kind: task_accepted,
                 task_id: "%s", title_snapshot: "forged" }]) { affectedCount } } $q$, :'e1_id', :'t1')) #>> '{errors,0,message}',
  'Unknown field', 'E1: no GraphQL insert mutation for notifications');

-- The read RPCs are exposed as mutations; a foreign id is ignored like over REST.
select is(graphql.resolve(format($q$ mutation { mark_notifications_read(p_ids: ["%s"]) } $q$, :'n_e2')) ? 'errors', false,
  'E1: mark_notifications_read via GraphQL with E2''s id runs');
select tests.authenticate_as(:'m_id');
select is(tests.gql_user_ids('{ notificationsCollection(first: 30) { edges { node { id user_id } } } }'), '[]'::jsonb,
  'manager (who sees all tasks) sees none of the executors'' notifications via GraphQL');
select lives_ok($$ select graphql.resolve('mutation { mark_all_notifications_read }') $$,
  'manager: mark_all_notifications_read via GraphQL');

select tests.authenticate_as(:'en_id');
select is(tests.gql_user_ids('{ notificationsCollection(first: 30) { edges { node { id user_id } } } }'), '[]'::jsonb,
  'a user without an effective role sees nothing via GraphQL, not even his own');

select tests.authenticate_anon();
select is(tests.gql_user_ids('{ notificationsCollection(first: 30) { edges { node { id user_id } } } }'), '[]'::jsonb,
  'anon gets no notifications via GraphQL');
select ok(graphql.resolve('{ notificationsCollection(first: 30) { edges { node { id } } } }') ? 'errors',
  'anon: notificationsCollection is not part of the anon GraphQL schema');

select tests.clear_authentication();
select is((select array_agg(read_at) from public.notifications where id in (:'n_e1', :'n_e2')),
  array[null, null]::timestamptz[], 'GraphQL mutation attempts and foreign ids changed no read_at');
select is((select count(*)::int from public.notifications where task_id in (:'t1', :'t2', :'t3')), 3,
  'the GraphQL mutation attempts inserted or deleted nothing');

select * from finish();
rollback;
