import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLI_TIMEOUT_MS,
  needsFullRead,
  projectGetArgs,
  readEpicTasks,
  runCli,
  sddListArgs,
  sddSections,
  sddTakenArgs,
  sortEpicTasks,
  subagentsArgs,
  taskCounts,
  taskCountsLine
} from '../mods/conport/cli.js'
import { CLI_VERSION } from '../mods/conport/version.js'

/** A document as the CLI names it: `doc-<N>`, the number never written out. */
const docRef = (n) => `doc-${n}`

/** A stand-in for Herdr's exec: records each call and answers from `answer`. */
function fakeExec(answer) {
  const calls = []
  const exec = async (command, args, options) => {
    calls.push({ command, args, options })
    return answer(command, args, options)
  }
  return { exec, calls }
}

test('runCli runs the pinned CLI through npx in the root, with a limit of 300 s', async () => {
  const { exec, calls } = fakeExec(() => ({ code: 0, stdout: '{"project":"prk7m2qx9d","epics":[]}', stderr: '' }))
  const answer = await runCli(exec, ['epic', 'list', '-p', 'acme', '--json'], '/r')
  assert.deepEqual(answer, { ok: true, data: { project: 'prk7m2qx9d', epics: [] } })
  assert.equal(CLI_TIMEOUT_MS, 300000)
  assert.deepEqual(calls, [
    {
      command: 'npx',
      args: ['-y', `conport@${CLI_VERSION}`, 'epic', 'list', '-p', 'acme', '--json'],
      options: { cwd: '/r', timeout: 300000 }
    }
  ])
})

test('runCli reads the refusal object of a --json command', async () => {
  const refusal = { ok: false, error: { code: 'epic_not_found', message: 'epic 9 is not an open epic', action: 'name another' } }
  const { exec } = fakeExec(() => ({ code: 2, stdout: `${JSON.stringify(refusal)}\n`, stderr: 'epic_not_found: epic 9 is not an open epic — name another\n' }))
  assert.deepEqual(await runCli(exec, ['x'], '/r'), {
    ok: false,
    error: { code: 'epic_not_found', fact: 'epic 9 is not an open epic', action: 'name another' }
  })
})

test('runCli reads the one line of the error stream when there is no refusal object', async () => {
  const { exec } = fakeExec(() => ({ code: 2, stdout: '', stderr: 'warning\nno_api_key: no API key is set — put CONPORT_API_KEY in ~/.config/conport/.env\n' }))
  assert.deepEqual(await runCli(exec, ['x'], '/r'), {
    ok: false,
    error: { code: 'no_api_key', fact: 'no API key is set', action: 'put CONPORT_API_KEY in ~/.config/conport/.env' }
  })
  const odd = fakeExec(() => ({ code: 1, stdout: '', stderr: 'something broke\n' }))
  assert.deepEqual(await runCli(odd.exec, ['x'], '/r'), { ok: false, error: { code: 'cli_failed', fact: 'something broke', action: '' } })
})

test('runCli: a success that is not JSON is bad_output', async () => {
  const { exec } = fakeExec(() => ({ code: 0, stdout: 'hello', stderr: '' }))
  assert.equal((await runCli(exec, ['x'], '/r')).error.code, 'bad_output')
})

test('runCli: exec rejecting for the limit is cli_timeout, for anything else npx_missing', async () => {
  const late = async () => {
    throw new Error('timed out after 300000 ms')
  }
  assert.equal((await runCli(late, ['x'], '/r')).error.code, 'cli_timeout')
  const timeout = async () => {
    throw new Error('exec: timeout')
  }
  assert.equal((await runCli(timeout, ['x'], '/r')).error.code, 'cli_timeout')
  const missing = async () => {
    throw new Error('No such file or directory (os error 2)')
  }
  const refused = await runCli(missing, ['x'], '/r')
  assert.equal(refused.error.code, 'npx_missing')
  assert.equal(refused.error.fact, 'No such file or directory (os error 2)')
})

test('subagentsArgs asks for the subagent types of one harness as JSON', () => {
  assert.deepEqual(subagentsArgs('codex'), ['epic', 'subagents', '--harness', 'codex', '--json'])
})

test('projectGetArgs reads the project, whose address names its team', () => {
  assert.deepEqual(projectGetArgs('prk7m2qx9d'), ['api', 'projects', 'get', '--project', 'prk7m2qx9d'])
})

const milestone = (id, sequence, extra = {}) => ({ id, title: `M${id}`, sequence, is_release: false, ready_to_close: false, open_epics: 1, ...extra })

const statuses = (list) => list.map((status, i) => ({ id: i + 1, title: `t${i + 1}`, status }))

test('taskCounts counts each status of the tasks of an epic, the cancelled ones in none', () => {
  const tasks = statuses(['TODO', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'DONE', 'DONE', 'CANCELLED'])
  assert.deepEqual(taskCounts(tasks), { todo: 2, inProgress: 1, review: 1, blocked: 1, parked: 0, done: 3, total: 8 })
})

test('taskCountsLine names only the statuses some task is in, count first, in the order of the work', () => {
  const tasks = statuses(['TODO', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'DONE', 'DONE', 'DONE', 'CANCELLED'])
  assert.equal(taskCountsLine(taskCounts(tasks)), '2 to do · 1 in progress · 1 in review · 1 blocked · 3 done')
  assert.equal(taskCountsLine(taskCounts(statuses(['TODO', 'TODO', 'TODO']))), '3 to do')
  assert.equal(taskCountsLine(taskCounts(statuses(['DONE', 'IN_PROGRESS', 'DONE']))), '1 in progress · 2 done')
  assert.equal(taskCountsLine(taskCounts(statuses(['PARKED', 'DONE']))), '1 parked · 1 done')
  // A cancelled task is in no count: an epic of cancelled tasks only, or of none, has no line.
  assert.equal(taskCountsLine(taskCounts(statuses(['CANCELLED']))), '')
  assert.equal(taskCountsLine(taskCounts([])), '')
})

test('sortEpicTasks puts the cancelled tasks last, each part by number', () => {
  const tasks = [
    { id: 5, status: 'CANCELLED' },
    { id: 3, status: 'DONE' },
    { id: 1, status: 'CANCELLED' },
    { id: 2, status: 'TODO' }
  ]
  assert.deepEqual(sortEpicTasks(tasks).map((t) => t.id), [2, 3, 1, 5])
  // As the Orca panel orders them: by number whatever the status, a done task stays in its place.
  const mixed = [
    { id: 9, status: 'TODO' },
    { id: 4, status: 'BLOCKED' },
    { id: 1, status: 'DONE' },
    { id: 6, status: 'IN_PROGRESS' }
  ]
  assert.deepEqual(sortEpicTasks(mixed).map((t) => t.id), [1, 4, 6, 9])
})

test('readEpicTasks reads every page of 200 tasks of the epic', async () => {
  const all = statuses(Array.from({ length: 450 }, (_, i) => (i % 7 === 0 ? 'CANCELLED' : 'DONE')))
  const { exec, calls } = fakeExec((_command, args) => {
    const offset = Number(args[args.indexOf('--offset') + 1])
    const limit = Number(args[args.indexOf('--limit') + 1])
    return { code: 0, stdout: JSON.stringify({ tasks: all.slice(offset, offset + limit), total: all.length }), stderr: '' }
  })
  const read = await readEpicTasks(exec, { epic: 412, project: 'prk7m2qx9d', root: '/r' })
  assert.equal(read.ok, true)
  assert.equal(read.data.length, 450)
  assert.equal(read.data.at(-1).status, 'CANCELLED')
  assert.deepEqual(
    calls.map((call) => call.args.slice(2)),
    [0, 200, 400].map((offset) => [
      'api', 'tasks', 'list', '--parent_task_id', '412', '--status', 'ALL', '--include_snoozed', 'true',
      '--limit', '200', '--offset', String(offset), '--project', 'prk7m2qx9d'
    ])
  )
  assert.ok(calls.every((call) => call.options.cwd === '/r' && call.options.timeout === 300000))
})

test('readEpicTasks: an answer without a list of tasks is bad_output', async () => {
  const { exec } = fakeExec(() => ({ code: 0, stdout: JSON.stringify({ tasks: null, total: 3 }), stderr: '' }))
  assert.equal((await readEpicTasks(exec, { epic: 1, project: 'p', root: '/r' })).error.code, 'bad_output')
})

test('readEpicTasks stops on an empty page and passes a refusal on', async () => {
  const empty = fakeExec(() => ({ code: 0, stdout: JSON.stringify({ tasks: [], total: 10 }), stderr: '' }))
  assert.deepEqual(await readEpicTasks(empty.exec, { epic: 1, project: 'p', root: '/r' }), { ok: true, data: [] })
  assert.equal(empty.calls.length, 1)
  const refused = fakeExec(() => ({ code: 1, stdout: '', stderr: 'conport_unreachable: no answer — check the network\n' }))
  assert.equal((await readEpicTasks(refused.exec, { epic: 1, project: 'p', root: '/r' })).error.code, 'conport_unreachable')
})

test('sddListArgs and sddTakenArgs read the stages and the taken rows of the project as JSON', () => {
  assert.deepEqual(sddListArgs('prk7m2qx9d'), ['sdd', 'list', '-p', 'prk7m2qx9d', '--json'])
  assert.deepEqual(sddTakenArgs('prk7m2qx9d'), ['sdd', 'list', '--taken', '-p', 'prk7m2qx9d', '--json'])
})

const idea = (id, priority, extra = {}) => ({ id, kind: 'task', title: `idea ${id}`, status: 'TODO', priority, changes_requested: false, ...extra })
const proposal = (doc) => ({ doc, title: `proposal ${doc}`, author: 'Anna' })
const inWork = (id, m, extra = {}) => ({
  id,
  title: `epic ${id}`,
  status: 'TODO',
  progress: { open: 1, total: 2 },
  milestone: m,
  ready: false,
  reason: null,
  spec: null,
  idea: null,
  ...extra
})
const outsideEpic = (id, m, tasks = [], extra = {}) => ({
  id,
  title: `epic ${id}`,
  status: 'TODO',
  milestone: m,
  progress: { open: tasks.length, total: tasks.length },
  tasks,
  ...extra
})

/** A list of `conport sdd list --json`, in the order the CLI gives it. */
const SDD = () => ({
  project: 'prk7m2qx9d',
  in_work: [
    inWork(1803, milestone(48, 1, { is_release: true, ready_to_close: true }), { ready: true }),
    inWork(1810, milestone(48, 1)),
    inWork(1820, milestone(50, 2), { status: 'IN_PROGRESS', updated_at: '2026-11-17T09:00:00Z', spec: 245, idea: 2233 }),
    inWork(1830, null)
  ],
  specs: [
    { doc: 245, title: 'spec 245', idea: 2233, priority: 2, epic: null, status: null },
    { doc: 190, title: 'spec 190', idea: null, priority: 3, epic: 1597, status: 'TODO' }
  ],
  ideas: [idea(2116, 1), idea(2117, 3, { status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z' }), idea(2118, 3, { kind: 'bug' }), idea(2119, 4)],
  proposals: [proposal(301), proposal(305)],
  skipped_proposals: [{ doc: 302, reason: 'no state line' }],
  outside: [
    outsideEpic(1916, milestone(26, 3), [idea(1917, 2), idea(1918, 3, { status: 'IN_PROGRESS', updated_at: '2026-11-17T07:00:00Z' })]),
    outsideEpic(1688, null)
  ]
})

const rowName = (row) => ('doc' in row ? `doc-${row.doc}` : `task-${row.id}`)

test('sddSections groups In work and Outside SDD by milestone and merges proposals into Ideas after priority 3', () => {
  const sections = sddSections(SDD())
  assert.equal(sections.project, 'prk7m2qx9d')
  assert.deepEqual(
    sections.inWork.map((group) => [group.milestone?.id ?? null, group.release, group.readyToClose, group.epics.map((epic) => epic.id)]),
    [
      [48, true, true, [1803, 1810]],
      [50, false, false, [1820]],
      [null, false, false, [1830]]
    ]
  )
  assert.equal(sections.inWork[0].epics[0].ready, true)
  assert.equal(sections.inWork[0].epics[1].ready, false)
  assert.deepEqual([sections.inWork[1].epics[0].spec, sections.inWork[1].epics[0].idea], [245, 2233])
  assert.deepEqual(
    sections.specs.map((spec) => [spec.doc, spec.epic]),
    [
      [245, null],
      [190, 1597]
    ]
  )
  // A proposal counts as priority 3: after the tasks of priority 3, before those of 4, by its number.
  assert.deepEqual(sections.ideas.map(rowName), ['task-2116', 'task-2117', 'task-2118', docRef(301), docRef(305), 'task-2119'])
  assert.equal(sections.skipped, 1)
  assert.deepEqual(
    sections.outside.map((group) => [group.milestone?.id ?? null, group.epics.map((epic) => [epic.id, epic.tasks.map((task) => task.id)])]),
    [
      [26, [[1916, [1917, 1918]]]],
      [null, [[1688, []]]]
    ]
  )
})

test('sddSections: proposals go after the ideas of priority 3 and above, or first when every idea is lower', () => {
  const high = sddSections({ ...SDD(), ideas: [idea(5, 1), idea(6, 4)], proposals: [proposal(9)] })
  assert.deepEqual(high.ideas.map(rowName), ['task-5', docRef(9), 'task-6'])
  const low = sddSections({ ...SDD(), ideas: [idea(6, 4)], proposals: [proposal(9)] })
  assert.deepEqual(low.ideas.map(rowName), [docRef(9), 'task-6'])
  const none = sddSections({ ...SDD(), ideas: [], proposals: [proposal(9)] })
  assert.deepEqual(none.ideas.map(rowName), [docRef(9)])
})

test('sddSections of no list is four empty sections', () => {
  const empty = { project: null, inWork: [], specs: [], ideas: [], skipped: 0, outside: [] }
  assert.deepEqual(sddSections(null), empty)
  assert.deepEqual(sddSections({ project: 'p' }), { ...empty, project: 'p' })
})

test('an idea back from review shows Fix, not In progress', () => {
  const list = SDD()
  list.ideas = [
    idea(40, 3, { status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', changes_requested: true }),
    idea(41, 3, { status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z' }),
    idea(42, 3, { status: 'REVIEW' }),
    idea(43, 3),
    idea(44, 3, { status: 'BLOCKED' })
  ]
  list.proposals = []
  assert.deepEqual(
    sddSections(list).ideas.map((row) => [row.id, row.mode, row.taken]),
    [
      [40, 'fix', false],
      [41, null, true],
      [42, 'review', false],
      [43, 'do', false],
      [44, null, false]
    ]
  )
  // A task of an epic outside SDD back from review is handed to fix as well.
  list.outside = [outsideEpic(1916, null, [idea(1917, 2, { status: 'IN_PROGRESS', changes_requested: true })])]
  assert.deepEqual(sddSections(list).outside[0].epics[0].tasks.map((task) => task.mode), ['fix'])
})

test('sddSections: an epic and an epic of a spec in progress are taken, a spec document never', () => {
  const sections = sddSections(SDD())
  assert.deepEqual(sections.inWork.flatMap((group) => group.epics.map((epic) => [epic.id, epic.taken])), [
    [1803, false],
    [1810, false],
    [1820, true],
    [1830, false]
  ])
  const list = SDD()
  list.specs[1].status = 'IN_PROGRESS'
  list.outside[0].status = 'IN_PROGRESS'
  const later = sddSections(list)
  assert.deepEqual(later.specs.map((spec) => spec.taken), [false, true])
  assert.deepEqual(later.outside.map((group) => group.epics[0].taken), [true, false])
})

const taken = (...ids) => ({ project: 'prk7m2qx9d', taken: ids.map((id) => ({ id, kind: 'task', updated_at: '2026-11-17T09:00:00Z' })) })

test('needsFullRead: the same set of taken rows needs no full read', () => {
  // The rows in progress of the list: epic 1820 and idea 2117 (task 1918 is a task of an epic).
  assert.equal(needsFullRead(SDD(), taken(1820, 2117)), false)
  assert.equal(needsFullRead(SDD(), taken(2117, 1820)), false)
})

test('needsFullRead: an unknown taken number, a vanished one', () => {
  // A number the list does not hold at all: a new idea taken at once. Every row in progress of
  // the list is still listed, so only the unknown number asks.
  assert.equal(needsFullRead(SDD(), taken(1820, 2117, 9999)), true)
  // A row the list holds in progress that the light read no longer lists; no unknown number.
  assert.equal(needsFullRead(SDD(), taken(1820)), true)
  assert.equal(needsFullRead(SDD(), taken()), true)
})

test('needsFullRead: the same number of taken rows with another content asks for a full read', () => {
  // Idea 2117 let go, idea 2116 (a row of the list) taken in the same minute.
  assert.equal(needsFullRead(SDD(), taken(1820, 2116)), true)
  // Idea 2117 let go, a number the list does not hold taken.
  assert.equal(needsFullRead(SDD(), taken(1820, 9999)), true)
})

test('needsFullRead: a row of the list taken from another client needs no full read', () => {
  // The light read marks it taken by itself: the list holds idea 2116, in TODO.
  assert.equal(needsFullRead(SDD(), taken(1820, 2117, 2116)), false)
})

test('needsFullRead ignores nothing the list cannot hold', () => {
  // Every root row of the list is known, whatever its section: an epic In work, the epic of a
  // spec, an idea, an epic outside SDD — taken in the light read, none of them is unknown.
  for (const id of [1803, 1597, 2116, 1916]) assert.equal(needsFullRead(SDD(), taken(1820, 2117, id)), false, String(id))
  // A spec document's number is no row the light read can hold: taken, it is unknown.
  assert.equal(needsFullRead(SDD(), taken(1820, 2117, 245)), true)
  // In progress in the list and missing from the light read, each of them asks for a full read.
  const list = SDD()
  list.specs[1].status = 'IN_PROGRESS'
  list.outside[0].status = 'IN_PROGRESS'
  assert.equal(needsFullRead(list, taken(1820, 2117, 1597, 1916)), false)
  assert.equal(needsFullRead(list, taken(1820, 2117, 1916)), true)
  assert.equal(needsFullRead(list, taken(1820, 2117, 1597)), true)
  // An idea back from review is in progress too, and the light read lists it: no full read.
  list.ideas[1].changes_requested = true
  assert.equal(needsFullRead(list, taken(1820, 2117, 1597, 1916)), false)
  // A task of an epic is no row the light read can hold (it reads the root tasks only): task 1918
  // in progress and absent from it asks for nothing, and a number known only as such a task is unknown.
  assert.equal(needsFullRead(SDD(), taken(1820, 2117)), false)
  assert.equal(needsFullRead(SDD(), taken(1820, 2117, 1918)), true)
})

test('needsFullRead: a taken unlisted idea asks for no full read', () => {
  // Idea 2240 is in progress and a tagged spec clarifies it: the list read it and shows it nowhere.
  const list = { ...SDD(), unlisted: [2240] }
  assert.equal(needsFullRead(list, taken(1820, 2117, 2240)), false)
  // Let go, it asks for nothing either: it is no row the list holds in progress.
  assert.equal(needsFullRead(list, taken(1820, 2117)), false)
  // Without the field (an older CLI) the number is unknown.
  assert.equal(needsFullRead(SDD(), taken(1820, 2117, 2240)), true)
})

test('needsFullRead with no list or no light read asks for the full read', () => {
  assert.equal(needsFullRead(null, taken()), true)
  assert.equal(needsFullRead(SDD(), null), true)
})
