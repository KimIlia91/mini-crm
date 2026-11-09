// Removes leftovers of test runs from the LOCAL database (users `*@example.test`, their tasks,
// history, notifications and objects). Demo accounts (`*@example.com`) and every object that still
// has a task of a non-test user are kept.
//   npm run db:clean:test
// Library use: import { cleanTestData } from './clean-test-data.mjs'
// SQL runs through `docker exec <db container> psql` as the local postgres superuser: the schema stays
// free of cleanup functions, and no secret key is needed. The container name is derived from
// `project_id` in supabase/config.toml, the same way the Supabase CLI names it.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getLocalSupabaseEnv } from './supabase-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CLEANUP_SQL = `
begin;

create temp table t_users on commit drop as
  select id from auth.users where email like '%@example.test';

create temp table keep_objects on commit drop as
  select distinct t.object_id as id
  from public.tasks t
  where not exists (
    select 1 from t_users u where u.id in (t.author_id, t.assignee_id)
  );

do $$
declare
  n_users int;
  n_tasks int;
  n_objects int;
begin
  select count(*) into n_users from t_users;
  if n_users = 0 then
    raise notice 'No test users found: nothing to clean.';
    return;
  end if;

  delete from public.notifications n
  where exists (
    select 1 from t_users u where u.id in (n.actor_id, n.resolved_by, n.user_id)
  );

  delete from public.tasks t
  where t.object_id not in (select id from keep_objects)
     or t.object_id in (
       select o.id from public.objects o where o.deleted_by in (select id from t_users)
     )
     or exists (
       select 1 from t_users u where u.id in (t.author_id, t.assignee_id, t.deleted_by)
     );
  get diagnostics n_tasks = row_count;

  delete from public.task_status_history h
  where h.changed_by in (select id from t_users);

  delete from public.objects o
  where o.id not in (select id from keep_objects)
     or o.deleted_by in (select id from t_users);
  get diagnostics n_objects = row_count;

  delete from auth.users where id in (select id from t_users);

  raise notice 'Removed: % test users, % tasks, % objects.', n_users, n_tasks, n_objects;
end
$$;

commit;
`

function readProjectId() {
  const config = readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8')
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(config)
  if (!match) throw new Error('project_id not found in supabase/config.toml')
  return match[1]
}

/** Cleans test leftovers from the local database. Throws if the local stack is not running. */
export function cleanTestData() {
  getLocalSupabaseEnv()
  const container = `supabase_db_${readProjectId()}`
  try {
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: CLEANUP_SQL, stdio: ['pipe', 'ignore', 'inherit'] },
    )
  } catch {
    throw new Error(`Test-data cleanup failed (container ${container}); see the output above.`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cleanTestData()
}
