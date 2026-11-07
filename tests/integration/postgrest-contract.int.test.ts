import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestUser, type TestUser } from '../setup/supabase'

// Pins the PostgREST behaviour that the server-side list queries (T-025 / T-029) rely on.
// Raw supabase-js calls only, no production code. All data is scoped by a unique tag and one
// object created here, so parallel suites never see (or affect) these rows.

const tag = `ctr${crypto.randomUUID().slice(0, 8)}`

let manager: TestUser
let e1: TestUser
let e2: TestUser
let objA: string
let objB: string

interface Row {
  id: string
  title: string
  created_at: string
  status_rank: number
  assignee: { id: string; full_name: string }
  object: { id: string; name: string }
}

// Untyped view of the client: the embedded aliases below are beyond the generated types.
const raw = (u: TestUser) => u.client as unknown as SupabaseClient

const ASSIGNEE_EMBED =
  'assignee:profiles!tasks_assignee_id_fkey!inner(id,full_name), assignee_search:profiles!tasks_assignee_id_fkey()'
const OBJECT_EMBED =
  'object:objects!tasks_object_id_fkey!inner(id,name), object_search:objects!tasks_object_id_fkey()'

const titles = {
  alpha: `${tag} alpha`,
  beta: `${tag} beta`,
  percent: `${tag} 100% sure`,
  underscore: `${tag} a_b`,
  plainAxb: `${tag} axb`,
  backslash: `${tag} back\\slash`,
  star: `${tag} star*`,
}

let ids: Record<keyof typeof titles, string>
let tieIds: string[]
let weirdId: string
const weirdTitle = `${tag} we(i)rd, a:b "q"`

function rowsOf(res: { data: unknown }): Row[] {
  return res.data as Row[]
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture row not found')
  return value
}

// Pattern helpers mirroring what the client must do. LIKE level: \ \% \_ are literal.
// Quoted or() value level: PostgREST consumes one backslash level (\\ -> \, \" -> ").
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, '\\$&')
const quoteValue = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

beforeAll(async () => {
  ;[manager, e1, e2] = await Promise.all([
    createTestUser('manager', `${tag}-m`),
    createTestUser('executor', `${tag}-x1`),
    createTestUser('executor', `${tag}-x2`),
  ])
  const objects = await manager.client
    .from('objects')
    .insert([
      { name: `${tag} obj-b`, address: 'addr' },
      { name: `${tag} obj-a`, address: 'addr' },
    ])
    .select('id, name')
  if (objects.error) throw objects.error
  objB = must(objects.data.find((o) => o.name.endsWith('obj-b'))).id
  objA = must(objects.data.find((o) => o.name.endsWith('obj-a'))).id

  // Separate statements -> distinct created_at.
  const entries: [keyof typeof titles, TestUser][] = [
    ['alpha', e1],
    ['beta', e2],
    ['percent', e1],
    ['underscore', e2],
    ['plainAxb', e1],
    ['backslash', e1],
    ['star', e2],
  ]
  const created: Partial<Record<keyof typeof titles, string>> = {}
  for (const [key, assignee] of entries) {
    const { data, error } = await manager.client
      .from('tasks')
      .insert({ object_id: objA, title: titles[key], assignee_id: assignee.id })
      .select('id')
      .single()
    if (error) throw error
    created[key] = data.id
  }
  ids = created as Record<keyof typeof titles, string>

  // One statement -> identical created_at for all rows (keyset ties). Three on object B.
  const ties = await manager.client
    .from('tasks')
    .insert(
      [0, 1, 2, 3, 4, 5].map((i) => ({
        object_id: i < 3 ? objA : objB,
        title: `${tag} tie ${i}`,
        assignee_id: i % 2 === 0 ? e1.id : e2.id,
      })),
    )
    .select('id, created_at')
  if (ties.error) throw ties.error
  tieIds = ties.data.map((t) => t.id)
  expect(new Set(ties.data.map((t) => t.created_at)).size).toBe(1)

  const weird = await manager.client
    .from('tasks')
    .insert({ object_id: objB, title: weirdTitle, assignee_id: e2.id })
    .select('id')
    .single()
  if (weird.error) throw weird.error
  weirdId = weird.data.id

  // status_rank: alpha -> in_progress (2); star -> rework (0); the rest stay new (1).
  const step = async (u: TestUser, id: string, to: 'in_progress' | 'in_review' | 'rework') => {
    const { error } = await u.client.rpc('change_task_status', {
      p_task_id: id,
      p_to_status: to,
      p_comment: 'ctr',
    })
    if (error) throw error
  }
  await step(e1, ids.alpha, 'in_progress')
  await step(e2, ids.star, 'in_progress')
  await step(e2, ids.star, 'in_review')
  await step(manager, ids.star, 'rework')
})

afterAll(async () => {
  // Soft-deleting the objects hides them and their tasks.
  for (const id of [objA, objB]) {
    await manager.client.rpc('delete_object', { p_object_id: id })
  }
})

// Task list of the whole (tagged) data set, as the manager sees it.
function managerSearch(pattern: string, quoted: string = pattern) {
  return raw(manager)
    .from('tasks')
    .select(`id, title, created_at, ${ASSIGNEE_EMBED}`, { count: 'exact' })
    .in('object_id', [objA, objB])
    .ilike('assignee_search.full_name', pattern)
    .or(`title.ilike."${quoted}",assignee_search.not.is.null`)
}

describe('1. search by title OR assignee name (double embed under an alias)', () => {
  it('returns title matches, assignee-name matches and the right exact count', async () => {
    // Pattern hits e1 by name (all e1 tasks) and nothing by title except "alpha".
    const byName = await managerSearch(`*${tag}-x1*`)
    expect(byName.error).toBeNull()
    const titlesSeen = rowsOf(byName)
      .map((r) => r.title)
      .sort()
    const expectedE1 = [
      titles.alpha,
      titles.percent,
      titles.plainAxb,
      titles.backslash,
      `${tag} tie 0`,
      `${tag} tie 2`,
      `${tag} tie 4`,
    ].sort()
    expect(titlesSeen).toEqual(expectedE1)
    expect(byName.count).toBe(expectedE1.length)

    // Title-only match ("beta" belongs to e2, whose name does not match).
    const byTitle = await managerSearch(`*${tag} beta*`)
    expect(byTitle.error).toBeNull()
    expect(rowsOf(byTitle).map((r) => r.title)).toEqual([titles.beta])
    expect(byTitle.count).toBe(1)

    // No match at all.
    const none = await managerSearch(`*${tag}-nothing-here*`)
    expect(none.error).toBeNull()
    expect(none.data).toEqual([])
    expect(none.count).toBe(0)
  })

  it('count with head:true equals the count with rows', async () => {
    const full = await managerSearch(`*${tag}-x1*`)
    const head = await raw(manager)
      .from('tasks')
      .select(`id, ${ASSIGNEE_EMBED}`, { count: 'exact', head: true })
      .in('object_id', [objA, objB])
      .ilike('assignee_search.full_name', `*${tag}-x1*`)
      .or(`title.ilike."*${tag}-x1*",assignee_search.not.is.null`)
    expect(head.error).toBeNull()
    expect(head.data).toBeNull()
    expect(head.count).toBe(full.count)
  })

  it('range + count: page rows are a slice of the full result, count is the full total', async () => {
    const page = await managerSearch(`*${tag}-x1*`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(2, 4)
    expect(page.error).toBeNull()
    expect(page.data).toHaveLength(3)
    expect(page.count).toBe(7)
  })

  it('My tasks: search by title OR object name through the object embed', async () => {
    const query = (pattern: string) =>
      raw(e1)
        .from('tasks')
        .select(`id, title, ${OBJECT_EMBED}`, { count: 'exact' })
        .ilike('object_search.name', pattern)
        .or(`title.ilike."${pattern}",object_search.not.is.null`)
        .like('title', `${tag}%`)
    // Object A name matches: all e1 tasks in A (alpha, percent, axb, backslash, tie 0, tie 2).
    const byObject = await query(`*${tag} obj-a*`)
    expect(byObject.error).toBeNull()
    expect(byObject.count).toBe(6)
    expect(byObject.data).toHaveLength(6)
    // Object B name: e1 has only "tie 4" there.
    const byObjectB = await query(`*${tag} obj-b*`)
    expect(byObjectB.error).toBeNull()
    expect(rowsOf(byObjectB).map((r) => r.title)).toEqual([`${tag} tie 4`])
    expect(byObjectB.count).toBe(1)
    // Title only.
    const byTitle = await query(`*${tag} alpha*`)
    expect(byTitle.error).toBeNull()
    expect(rowsOf(byTitle).map((r) => r.title)).toEqual([titles.alpha])
    expect(byTitle.count).toBe(1)
  })
})

describe('2. wildcards, escaping and injection in ilike / or()', () => {
  const titlesOf = (r: { data: unknown }) =>
    rowsOf(r)
      .map((x) => x.title)
      .sort()
  const byTitleOr = (value: string) =>
    raw(manager)
      .from('tasks')
      .select('id, title')
      .in('object_id', [objA, objB])
      .or(`title.ilike."${quoteValue(value)}"`)

  it('"*" works as "%" in ilike (plain filter and inside or())', async () => {
    const plain = await raw(manager)
      .from('tasks')
      .select('title')
      .in('object_id', [objA])
      .ilike('title', `${tag} al*`)
    expect(titlesOf(plain)).toEqual([titles.alpha])
    const inOr = await byTitleOr(`${tag} al*`)
    expect(titlesOf(inOr)).toEqual([titles.alpha])
  })

  it('"_" is a single-char wildcard unless escaped; "\\_" is literal', async () => {
    const wild = await byTitleOr(`${tag} a_b`)
    expect(titlesOf(wild)).toEqual([titles.plainAxb, titles.underscore].sort())
    const literal = await byTitleOr(`${tag} ${likeLiteral('a_b')}`)
    expect(titlesOf(literal)).toEqual([titles.underscore])
  })

  it('"%" is a wildcard unless escaped; "\\%" is literal', async () => {
    const wild = await byTitleOr(`${tag} 100%`)
    expect(titlesOf(wild)).toEqual([titles.percent])
    const prefix = await byTitleOr(`${tag} 1%`)
    expect(titlesOf(prefix)).toEqual([titles.percent])
    const literal = await byTitleOr(`*${tag} ${likeLiteral('100%')}*`)
    expect(titlesOf(literal)).toEqual([titles.percent])
    const literalNoMatch = await byTitleOr(`*${tag} ${likeLiteral('10%0')}*`)
    expect(titlesOf(literalNoMatch)).toEqual([])
  })

  it('"\\\\" is a literal backslash', async () => {
    const literal = await byTitleOr(`*${tag} ${likeLiteral('back\\slash')}*`)
    expect(literal.error).toBeNull()
    expect(titlesOf(literal)).toEqual([titles.backslash])
  })

  it('a backslash inside quotes that is not doubled is swallowed by PostgREST (escape lost)', async () => {
    // PostgREST unquotes "a\_b" to a_b: "_" is a wildcard again and axb matches too.
    const res = await raw(manager)
      .from('tasks')
      .select('title')
      .in('object_id', [objA])
      .or(`title.ilike."${tag} a\\_b"`)
    expect(titlesOf(res)).toEqual([titles.plainAxb, titles.underscore].sort())
    // Outside quotes (and in a plain .ilike()) a single backslash is the LIKE escape.
    const plain = await raw(manager)
      .from('tasks')
      .select('title')
      .in('object_id', [objA])
      .ilike('title', `${tag} a\\_b`)
    expect(titlesOf(plain)).toEqual([titles.underscore])
  })

  it('a literal "*" cannot be expressed: it is always a wildcard', async () => {
    // "star*" matches the star task, but so would any suffix; "*" is not escapable.
    const star = await byTitleOr(`${tag} star*`)
    expect(titlesOf(star)).toEqual([titles.star])
    // "_" (what the client helper maps "*" to) matches the literal "*" and anything else.
    const underscore = await byTitleOr(`${tag} star_`)
    expect(titlesOf(underscore)).toEqual([titles.star])
  })

  it.each([
    ['closing paren + extra condition', 'a),id.not.is.null'],
    ['quote break-out', 'x",title.ilike."*'],
    ['open paren', '('],
    ['comma', ','],
    ['colon', ':'],
    ['all together', '"),id.not.is.null,(title.ilike.*'],
  ])('injection attempt (%s) does not widen the result', async (_name, evil) => {
    // Quoted value: embedded quotes are escaped as \" by the caller's quoting rules.
    const quoted = quoteValue(evil)
    const all = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('object_id', [objA, objB])
    expect(all.count).toBe(14)
    const attempt = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact' })
      .in('object_id', [objA, objB])
      .or(`title.ilike."${quoted}"`)
    // Either a clean error or an (empty) literal match, never the whole table.
    if (attempt.error === null) {
      expect(attempt.data).toEqual([])
      expect(attempt.count).toBe(0)
    }
    const unquoted = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact' })
      .in('object_id', [objA, objB])
      .or(`title.ilike.${evil}`)
    if (unquoted.error === null) expect(unquoted.data.length).toBeLessThan(14)
  })

  it('literal special characters inside quotes match titles containing them', async () => {
    // The fixture title contains ",", "(", ")", ":" and double quotes.
    for (const piece of ['we(i)rd, a:b', 'a:b "q"']) {
      const res = await byTitleOr(`*${piece}*`)
      expect(res.error).toBeNull()
      expect(rowsOf(res).map((r) => r.id)).toEqual([weirdId])
    }
  })
})

describe('3. offset beyond the total', () => {
  it('offset > total with count:exact returns PGRST103', async () => {
    const res = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('object_id', objB)
      .range(50, 59)
    expect(res.error?.code).toBe('PGRST103')
    expect(res.data).toBeNull()
  })

  it('offset == total (non-zero) behaves as recorded', async () => {
    const total = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('object_id', objB)
    const res = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('object_id', objB)
      .range(total.count ?? -1, (total.count ?? -1) + 9)
    // Recorded: offset == total is NOT an error: 200 with an empty page and the real count.
    expect(total.count).toBe(4)
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(res.count).toBe(4)
  })

  it('empty result with offset 0 is fine and count is 0', async () => {
    const res = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('title', `${tag}-absent`)
      .range(0, 9)
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(res.count).toBe(0)
  })

  it('recovery path: head count WITHOUT a range returns the true total', async () => {
    const withRange = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('object_id', objB)
      .range(50, 59)
    // Recorded: a head request with an out-of-range window fails (416, empty body) with no count,
    // so the recovery query must not carry the range.
    expect(withRange.error).not.toBeNull()
    expect(withRange.status).toBe(416)
    expect(withRange.count).toBeNull()
    const noRange = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('object_id', objB)
    expect(noRange.error).toBeNull()
    expect(noRange.count).toBe(4)
  })
})

async function allTasks(): Promise<Row[]> {
  const res = await raw(manager)
    .from('tasks')
    .select('id, created_at')
    .in('object_id', [objA, objB])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (res.error) throw res.error
  return rowsOf(res)
}

describe('4. keyset pagination with a single or()', () => {
  const keysetFilter = (c: { created_at: string; id: string }) =>
    `created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt.${c.id})`

  it('the raw created_at string has microsecond precision and ties exist', async () => {
    const rows = await allTasks()
    expect(rows).toHaveLength(14)
    const tieRow = must(rows.find((r) => tieIds.includes(r.id)))
    expect(tieRow.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{1,6}\+00:00$/)
    expect(rows.filter((r) => r.created_at === tieRow.created_at)).toHaveLength(6)
  })

  it('walks the whole set page by page without gaps or duplicates', async () => {
    const expected = (await allTasks()).map((r) => r.id)
    const seen: string[] = []
    let cursor: Row | undefined = undefined
    for (let guard = 0; guard < 20; guard++) {
      let q = raw(manager)
        .from('tasks')
        .select('id, created_at')
        .in('object_id', [objA, objB])
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(4)
      if (cursor) q = q.or(keysetFilter(cursor))
      const res = await q
      expect(res.error).toBeNull()
      const rows = rowsOf(res)
      if (rows.length === 0) break
      seen.push(...rows.map((r) => r.id))
      cursor = rows.at(-1)
    }
    expect(seen).toEqual(expected)
  })

  it('a truncated (millisecond) timestamp would break ties; the raw string does not', async () => {
    const rows = await allTasks()
    const tie = must(rows.find((r) => tieIds.includes(r.id)))
    const ms = new Date(tie.created_at).toISOString() // loses microseconds
    const raw1 = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('object_id', [objA, objB])
      .or(
        `created_at.lt."${tie.created_at}",and(created_at.eq."${tie.created_at}",id.lt.${tie.id})`,
      )
    const lossy = await raw(manager)
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('object_id', [objA, objB])
      .or(`created_at.lt."${ms}",and(created_at.eq."${ms}",id.lt.${tie.id})`)
    const index = rows.findIndex((r) => r.id === tie.id)
    expect(raw1.count).toBe(rows.length - index - 1)
    expect(lossy.error).toBeNull()
    // Truncation only moves the cursor earlier, so ties at the cursor are skipped, never added.
    expect(lossy.count).toBeLessThanOrEqual(raw1.count ?? 0)
  })

  it('nested or(and(or(search), or(keyset))) keeps both conditions', async () => {
    const searchTitle = `*${tag} tie*`
    const searchOr = `title.ilike."${searchTitle}",assignee_search.not.is.null`
    const base = () =>
      raw(manager)
        .from('tasks')
        .select(`id, created_at, ${ASSIGNEE_EMBED}`, { count: 'exact' })
        .in('object_id', [objA, objB])
        .ilike('assignee_search.full_name', searchTitle)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    const first = await base().or(`and(or(${searchOr}))`).limit(2)
    expect(first.error).toBeNull()
    expect(first.count).toBe(6)
    const rows = rowsOf(first)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => tieIds.includes(r.id))).toBe(true)

    const cursor = must(rows[1])
    const next = await base()
      .or(`and(or(${searchOr}),or(${keysetFilter(cursor)}))`)
      .limit(10)
    expect(next.error).toBeNull()
    const nextIds = rowsOf(next).map((r) => r.id)
    const all = rowsOf(await base().or(`and(or(${searchOr}))`))
    const idx = all.findIndex((r) => r.id === cursor.id)
    expect(nextIds).toEqual(all.slice(idx + 1).map((r) => r.id))
    expect(nextIds).toHaveLength(4)
  })
})

describe('5. ordering', () => {
  it('orders by the embedded assignee full_name with id as the second key', async () => {
    for (const ascending of [true, false]) {
      const res = await raw(manager)
        .from('tasks')
        .select(`id, ${ASSIGNEE_EMBED}`)
        .in('object_id', [objA, objB])
        .order('assignee(full_name)', { ascending })
        .order('id', { ascending })
      expect(res.error).toBeNull()
      const rows = rowsOf(res)
      expect(rows).toHaveLength(14)
      const names = rows.map((r) => r.assignee.full_name)
      // e1 (x1) sorts before e2 (x2) ascending.
      const sorted = [...names].sort()
      expect(names).toEqual(ascending ? sorted : sorted.reverse())
      // Ties on the name are ordered by id in the same direction.
      for (let i = 1; i < rows.length; i++) {
        if (names[i] === names[i - 1]) {
          const [prev, cur] = [must(rows[i - 1]), must(rows[i])]
          expect(ascending ? prev.id < cur.id : prev.id > cur.id).toBe(true)
        }
      }
    }
  })

  it('orders by the embedded object name', async () => {
    const res = await raw(manager)
      .from('tasks')
      .select(`id, ${OBJECT_EMBED}`)
      .in('object_id', [objA, objB])
      .order('object(name)', { ascending: true })
      .order('id', { ascending: true })
    expect(res.error).toBeNull()
    const names = rowsOf(res).map((r) => r.object.name)
    expect(names).toEqual([...names].sort())
    expect((names[0] ?? '').endsWith('obj-a')).toBe(true)
    expect((names.at(-1) ?? '').endsWith('obj-b')).toBe(true)
  })

  it('orders by status_rank, then created_at desc, then id', async () => {
    const res = await raw(manager)
      .from('tasks')
      .select('id, title, status_rank, created_at')
      .in('object_id', [objA, objB])
      .order('status_rank', { ascending: true })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    expect(res.error).toBeNull()
    const rows = rowsOf(res)
    const ranks = rows.map((r) => r.status_rank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(must(rows[0]).title).toBe(titles.star) // rework = 0
    expect(must(rows[0]).status_rank).toBe(0)
    const lastRow = must(rows.at(-1))
    expect(lastRow.title).toBe(titles.alpha) // in_progress = 2 (only non-new left)
    expect(lastRow.status_rank).toBe(2)
    // Within rank 1: created_at desc, id desc.
    const mid = rows.filter((r) => r.status_rank === 1)
    for (let i = 1; i < mid.length; i++) {
      const [a, b] = [must(mid[i - 1]), must(mid[i])]
      expect(a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id)).toBe(
        true,
      )
    }
  })

  it('status_rank cannot be written by clients', async () => {
    const res = await manager.client
      .from('tasks')
      .update({ status_rank: 9 } as never)
      .eq('id', ids.beta)
    expect(res.error).not.toBeNull()
  })
})

describe('6. executor sees only own tasks, count included', () => {
  it('search + count are scoped by RLS to the executor', async () => {
    // e2 searches for e1's name: the embed row of e1 is visible via profiles RLS? Either way the
    // task rows of e1 must never be returned or counted.
    const res = await raw(e2)
      .from('tasks')
      .select(`id, title, ${ASSIGNEE_EMBED}`, { count: 'exact' })
      .in('object_id', [objA, objB])
      .ilike('assignee_search.full_name', `*${tag}-x1*`)
      .or(`title.ilike."*${tag}-x1*",assignee_search.not.is.null`)
    expect(res.error).toBeNull()
    expect(res.data).toEqual([])
    expect(res.count).toBe(0)
  })

  it('without a filter the executor gets only own rows and own count', async () => {
    const res = await raw(e2)
      .from('tasks')
      .select('id, assignee_id', { count: 'exact' })
      .in('object_id', [objA, objB])
    expect(res.error).toBeNull()
    expect((res.data as { assignee_id: string }[]).every((r) => r.assignee_id === e2.id)).toBe(true)
    // beta, underscore, star, tie 1, tie 3, tie 5, weird.
    expect(res.count).toBe(7)
    expect(res.data).toHaveLength(7)
  })

  it('executor keyset, ordering and out-of-range behave the same, on own rows only', async () => {
    const page1 = await raw(e1)
      .from('tasks')
      .select('id, created_at', { count: 'exact' })
      .in('object_id', [objA, objB])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(3)
    expect(page1.error).toBeNull()
    expect(page1.count).toBe(7)
    const last = must(rowsOf(page1)[2])
    const page2 = await raw(e1)
      .from('tasks')
      .select('id, created_at', { count: 'exact' })
      .in('object_id', [objA, objB])
      .or(
        `created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt.${last.id})`,
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    expect(page2.error).toBeNull()
    expect(page2.count).toBe(4)

    const beyond = await raw(e1)
      .from('tasks')
      .select('id', { count: 'exact' })
      .in('object_id', [objA, objB])
      .range(50, 59)
    expect(beyond.error?.code).toBe('PGRST103')
  })

  it('executor ordering by embedded object name works on own rows', async () => {
    const res = await raw(e1)
      .from('tasks')
      .select(`id, ${OBJECT_EMBED}`)
      .in('object_id', [objA, objB])
      .order('object(name)', { ascending: true })
      .order('id', { ascending: true })
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(7)
  })
})
