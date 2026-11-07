// Demo data for the LOCAL Supabase stack: 4 users, 3 objects, 8 tasks in all 5 statuses.
//   DEMO_PASSWORD=... DEMO_NEW_USER_PASSWORD=... npm run db:seed:demo
// Run on a fresh database (`npm run db:reset`). Data is created only through the public API
// as the right actor (publishable-key clients), so RLS, triggers and history behave as in the app.
// Cloud project (explicit, on an empty project; the values stay in your shell):
//   SEED_SUPABASE_URL=... SEED_SUPABASE_PUBLISHABLE_KEY=... SEED_SUPABASE_SECRET_KEY=...
//   DEMO_PASSWORD=... DEMO_NEW_USER_PASSWORD=... node scripts/seed-demo.mjs --cloud
import { randomBytes } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import { getLocalSupabaseAdminEnv, getLocalSupabaseEnv } from './supabase-env.mjs'

// Same policy as the Auth server: at least 8 characters, lower + upper case letters, digits.
function passwordProblem(value) {
  if (!value) return 'не задан'
  if (value.length < 8) return 'короче 8 символов'
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return 'нужны строчные, заглавные буквы и цифры'
  }
  return null
}

function readPasswords() {
  const names = ['DEMO_PASSWORD', 'DEMO_NEW_USER_PASSWORD']
  const problems = names
    .map((name) => [name, passwordProblem(process.env[name])])
    .filter(([, problem]) => problem)
    .map(([name, problem]) => `${name}: ${problem}`)
  if (problems.length > 0) {
    console.error(`Ошибка: некорректные пароли демо-пользователей.\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  return { demo: process.env.DEMO_PASSWORD, newUser: process.env.DEMO_NEW_USER_PASSWORD }
}

const USERS = {
  manager: { email: 'manager@example.com', fullName: 'Ирина Соколова', role: 'manager' },
  executor1: { email: 'executor1@example.com', fullName: 'Алексей Петров', role: 'executor' },
  executor2: { email: 'executor2@example.com', fullName: 'Марина Кузнецова', role: 'executor' },
  newbie: { email: 'newbie@example.com', fullName: 'Олег Новиков', role: 'executor' },
}

const OBJECTS = [
  {
    key: 'zhk',
    name: 'ЖК «Видный Берег», корпус 3',
    address: 'Московская обл., г. Видное, ул. Берёзовая, 12',
  },
  {
    key: 'warehouse',
    name: 'Склад «Подольск-Логистик»',
    address: 'Московская обл., г. Подольск, Домодедовское шоссе, 41',
  },
  {
    key: 'office',
    name: 'Офис «Химки-Сити»',
    address: 'Московская обл., г. Химки, ул. Ленинградская, 29, оф. 5',
  },
]

// Planned path of every task: the final status is reached via real transitions.
// `reworkComment` is the manager's remark for tasks that went through rework.
const TASKS = [
  {
    object: 'zhk',
    executor: 'executor1',
    title: 'Армирование монолитного перекрытия 5 этажа',
    description:
      'Выполнить вязку арматуры по КЖ-5, проверить защитный слой и шаг стержней до бетонирования.',
    path: ['in_progress', 'in_review', 'accepted'],
  },
  {
    object: 'zhk',
    executor: 'executor2',
    title: 'Монтаж оконных блоков в секции 2',
    description:
      'Установить ПВХ-блоки по осям А–Г, выставить по уровню, закрепить анкерами и вспенить швы.',
    path: ['in_progress', 'in_review'],
  },
  {
    object: 'zhk',
    executor: 'executor1',
    title: 'Устройство стяжки пола в местах общего пользования',
    description:
      'Залить цементно-песчаную стяжку 50 мм с армосеткой, обеспечить уход за бетоном 7 суток.',
    path: ['in_progress'],
  },
  {
    object: 'warehouse',
    executor: 'executor2',
    title: 'Монтаж стеллажной системы в зоне хранения',
    description:
      'Собрать паллетные стеллажи по схеме расстановки, выверить вертикаль и закрепить анкерами к полу.',
    path: ['in_progress', 'in_review', 'rework'],
    reworkComment:
      'Не выдержан зазор между рядами 1,2 м и не закреплены нижние балки. Переделать и приложить фото.',
  },
  {
    object: 'warehouse',
    executor: 'executor1',
    title: 'Прокладка кабельных трасс освещения',
    description:
      'Проложить кабельные лотки по фермам, смонтировать светильники и подключить к щиту ЩО-2.',
    path: [],
  },
  {
    object: 'warehouse',
    executor: 'executor1',
    title: 'Нанесение разметки на пол склада',
    description: 'Нанести износостойкую краску для разметки проездов и зон хранения по плану.',
    path: ['in_progress', 'in_review', 'rework', 'in_progress', 'in_review', 'accepted'],
    reworkComment: 'Линии разметки смещены от проектных осей на 5–8 см, нужна перекраска по плану.',
  },
  {
    object: 'warehouse',
    executor: 'executor2',
    title: 'Устройство пожарной сигнализации',
    description:
      'Смонтировать извещатели и оповещатели, проложить шлейфы, оформить акт пусконаладки.',
    path: [],
  },
  {
    object: 'office',
    executor: 'executor1',
    title: 'Монтаж подвесных потолков в опенспейсе',
    description:
      'Смонтировать каркас и плиты Armstrong, предусмотреть ревизионные люки под вентиляцию.',
    path: ['in_progress', 'in_review'],
  },
]

function fail(context, error) {
  throw new Error(`${context}: ${error?.message ?? 'неизвестная ошибка'}`)
}

function clientFor(env) {
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Temporary password, only used to sign in once before the real first password change.
const temporaryPassword = () => `Tmp1${randomBytes(12).toString('hex')}`

async function assertNoDemoUsers(admin) {
  const wanted = new Set(Object.values(USERS).map((u) => u.email))
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail('Не удалось получить список пользователей', error)
    if (data.users.some((u) => wanted.has(u.email ?? ''))) {
      console.error(
        'Ошибка: демо-пользователи уже есть; пересоздать: npm run db:reset, затем снова db:seed:demo.',
      )
      process.exit(1)
    }
    if (data.users.length < 200) return
  }
}

// `--recreate`: removes only the demo accounts, and only while they own no objects or tasks
// (e.g. accounts left without profiles by an earlier run). Real data is never deleted here.
async function removeDemoUsers(admin) {
  const wanted = new Set(Object.values(USERS).map((u) => u.email))
  const found = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail('Не удалось получить список пользователей', error)
    found.push(...data.users.filter((u) => wanted.has(u.email ?? '')))
    if (data.users.length < 200) break
  }
  if (found.length === 0) return
  const ids = found.map((u) => u.id)
  const [tasks, objects] = await Promise.all([
    admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .or(`author_id.in.(${ids.join(',')}),assignee_id.in.(${ids.join(',')})`),
    admin.from('objects').select('id', { count: 'exact', head: true }),
  ])
  if (tasks.error) fail('Не удалось проверить задачи демо-пользователей', tasks.error)
  if (objects.error) fail('Не удалось проверить объекты', objects.error)
  if ((tasks.count ?? 0) > 0 || (objects.count ?? 0) > 0) {
    console.error(
      'Ошибка: у демо-пользователей уже есть данные (объекты/задачи) — --recreate их не удаляет.',
    )
    process.exit(1)
  }
  for (const user of found) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) fail(`Не удалось удалить ${user.email ?? user.id}`, error)
  }
  console.log(`Удалены прежние демо-пользователи без данных: ${String(found.length)}`)
}

async function createUser(admin, user, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    app_metadata: { app_role: user.role },
    user_metadata: { full_name: user.fullName },
  })
  if (error) fail(`Не удалось создать ${user.email}`, error)
  return data.user.id
}

// Creates the user with a temporary password, then performs the real first password change.
async function createUserWithChangedPassword(admin, env, user, finalPassword) {
  const temp = temporaryPassword()
  const id = await createUser(admin, user, temp)
  const client = clientFor(env)
  const signIn = await client.auth.signInWithPassword({ email: user.email, password: temp })
  if (signIn.error) fail(`Не удалось войти как ${user.email}`, signIn.error)
  const update = await client.auth.updateUser({ password: finalPassword })
  if (update.error) fail(`Не удалось сменить пароль ${user.email}`, update.error)
  return { id, client }
}

function readLocalEnv() {
  return { env: getLocalSupabaseEnv(), adminEnv: getLocalSupabaseAdminEnv() }
}

// `--cloud`: an explicitly requested run against a hosted project. All values come from the
// environment of the person running it (never from files); the secret key is never printed.
function readCloudEnv() {
  const url = process.env.SEED_SUPABASE_URL ?? ''
  const publishableKey = process.env.SEED_SUPABASE_PUBLISHABLE_KEY ?? ''
  const secretKey = process.env.SEED_SUPABASE_SECRET_KEY ?? ''
  const host = URL.canParse(url) ? new URL(url).hostname : ''
  const problems = [
    !/^[a-z0-9]+\.supabase\.co$/.test(host) && 'SEED_SUPABASE_URL (https://<ref>.supabase.co)',
    !publishableKey.startsWith('sb_publishable_') &&
      'SEED_SUPABASE_PUBLISHABLE_KEY (sb_publishable_…)',
    !secretKey.startsWith('sb_secret_') && 'SEED_SUPABASE_SECRET_KEY (sb_secret_…)',
  ].filter(Boolean)
  if (problems.length > 0) {
    console.error(`Ошибка: для --cloud не заданы или некорректны: ${problems.join(', ')}`)
    process.exit(1)
  }
  console.log(`Облачный проект: ${host}`)
  return { env: { url, publishableKey }, adminEnv: { url, secretKey } }
}

async function main() {
  const passwords = readPasswords() // fail fast, before any network call

  const { env, adminEnv } = process.argv.includes('--cloud') ? readCloudEnv() : readLocalEnv()
  const admin = createClient(adminEnv.url, adminEnv.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (process.argv.includes('--recreate')) await removeDemoUsers(admin)
  await assertNoDemoUsers(admin)

  const manager = await createUserWithChangedPassword(admin, env, USERS.manager, passwords.demo)
  const actors = {
    manager,
    executor1: await createUserWithChangedPassword(admin, env, USERS.executor1, passwords.demo),
    executor2: await createUserWithChangedPassword(admin, env, USERS.executor2, passwords.demo),
  }
  // The new employee keeps must_change_password = true: shows the forced change on first login.
  await createUser(admin, USERS.newbie, passwords.newUser)

  const objectIds = {}
  for (const { key, name, address } of OBJECTS) {
    const { data, error } = await manager.client
      .from('objects')
      .insert({ name, address })
      .select('id')
      .single()
    if (error) fail(`Не удалось создать объект «${name}»`, error)
    objectIds[key] = data.id
  }

  const counts = {}
  for (const task of TASKS) {
    const { data, error } = await manager.client
      .from('tasks')
      .insert({
        object_id: objectIds[task.object],
        title: task.title,
        description: task.description,
        assignee_id: actors[task.executor].id,
      })
      .select('id')
      .single()
    if (error) fail(`Не удалось создать задачу «${task.title}»`, error)

    let current = 'new'
    for (const next of task.path) {
      // Executors move tasks forward; the manager accepts or returns them for rework.
      const actor = current === 'in_review' ? manager : actors[task.executor]
      const { error: rpcError } = await actor.client.rpc('change_task_status', {
        p_task_id: data.id,
        p_to_status: next,
        p_comment: next === 'rework' ? task.reworkComment : undefined,
      })
      if (rpcError) fail(`Не удалось перевести «${task.title}» в ${next}`, rpcError)
      current = next
    }
    counts[current] = (counts[current] ?? 0) + 1
  }

  console.log(`Демо-данные созданы: объектов ${OBJECTS.length}, задач ${TASKS.length}.`)
  console.log('Задачи по статусам:')
  for (const status of ['new', 'in_progress', 'in_review', 'accepted', 'rework']) {
    console.log(`  ${status.padEnd(12)} ${counts[status] ?? 0}`)
  }
  console.log('Логины (пароли — из DEMO_PASSWORD / DEMO_NEW_USER_PASSWORD):')
  for (const user of Object.values(USERS)) {
    console.log(`  ${user.email}  ${user.fullName} (${user.role})`)
  }
  console.log('newbie@example.com: при первом входе потребуется смена пароля.')
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`)
  process.exit(1)
})
