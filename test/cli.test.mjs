import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLI_TIMEOUT_MS,
  epicListArgs,
  epicTabs,
  HAND_BUTTONS,
  readEpicTasks,
  runCli,
  sortEpicTasks,
  subagentsArgs,
  taskCounts,
  taskCountsLine,
  taskListArgs,
  taskTabs
} from '../mods/conport/cli.js'
import { CLI_VERSION } from '../mods/conport/version.js'

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

test('the list commands name the project and ask for JSON', () => {
  assert.deepEqual(epicListArgs('acme'), ['epic', 'list', '-p', 'acme', '--json'])
  assert.deepEqual(taskListArgs('acme'), ['task', 'list', '-p', 'acme', '--json'])
})

test('subagentsArgs asks for the subagent types of one harness as JSON', () => {
  assert.deepEqual(subagentsArgs('codex'), ['epic', 'subagents', '--harness', 'codex', '--json'])
})

const milestone = (id, sequence, extra = {}) => ({ id, title: `M${id}`, sequence, is_release: false, ready_to_close: false, open_epics: 1, ...extra })
const epic = (id, extra = {}) => ({
  id,
  title: `Epic ${id}`,
  status: 'TODO',
  progress: { open: 2, total: 3 },
  milestone: null,
  runnable: true,
  reason: null,
  ready: false,
  ...extra
})

test('epicTabs: runnable epics by milestone in roadmap order, the others to prepare with what they lack', () => {
  const list = {
    project: 'prk7m2qx9d',
    epics: [
      epic(1, { milestone: milestone(20, 2) }),
      epic(2, { runnable: false, reason: 'no spec' }),
      epic(3, { milestone: milestone(10, 1, { is_release: true, ready_to_close: true }), ready: true }),
      epic(4),
      epic(5, { runnable: false, reason: 'no plan', milestone: milestone(10, 1) }),
      epic(6, { runnable: false, reason: 'an open dependency' }),
      epic(7, { milestone: milestone(20, 2) })
    ]
  }
  const tabs = epicTabs(list)
  assert.equal(tabs.project, 'prk7m2qx9d')
  assert.deepEqual(tabs.counts, { launch: 4, prepare: 3 })
  assert.deepEqual(
    tabs.launch.map((group) => ({ milestone: group.milestone?.id ?? null, epics: group.epics.map((e) => e.id) })),
    [
      { milestone: 10, epics: [3] },
      { milestone: 20, epics: [1, 7] },
      { milestone: null, epics: [4] }
    ]
  )
  assert.equal(tabs.launch[0].release, true)
  assert.equal(tabs.launch[0].readyToClose, true)
  assert.equal(tabs.launch[0].epics[0].ready, true)
  assert.equal(tabs.launch[1].release, false)
  assert.deepEqual(
    tabs.prepare.map((e) => [e.id, e.missing]),
    [
      [2, 'spec'],
      [5, 'plan'],
      [6, null]
    ]
  )
})

test('taskTabs: review, in progress and to do by priority, with the bug mark and the button of each', () => {
  const list = {
    project: 'prk7m2qx9d',
    tasks: [
      { id: 11, kind: 'task', title: 'a', status: 'TODO', priority: 3, changes_requested: false },
      { id: 12, kind: 'bug', title: 'b', status: 'REVIEW', priority: 2, changes_requested: false },
      { id: 13, kind: 'task', title: 'c', status: 'IN_PROGRESS', priority: 3, changes_requested: true },
      { id: 14, kind: 'bug', title: 'd', status: 'TODO', priority: 1, changes_requested: false },
      { id: 15, kind: 'task', title: 'e', status: 'IN_PROGRESS', priority: 1, changes_requested: false },
      { id: 16, kind: 'task', title: 'f', status: 'TODO', priority: 3, changes_requested: false }
    ]
  }
  const tabs = taskTabs(list)
  assert.equal(tabs.project, 'prk7m2qx9d')
  assert.deepEqual(tabs.counts, { review: 1, inProgress: 2, todo: 3, total: 6 })
  const rows = (group) => group.map((t) => [t.id, t.bug, t.mode, t.mode === null ? null : HAND_BUTTONS[t.mode]])
  assert.deepEqual(rows(tabs.review), [[12, true, 'review', 'Review']])
  assert.deepEqual(rows(tabs.inProgress), [
    [13, false, 'fix', 'Fix'],
    [15, false, null, null]
  ])
  // By priority; tasks of one priority keep the order the server gave.
  assert.deepEqual(rows(tabs.todo), [
    [14, true, 'do', 'Hand to agent'],
    [11, false, 'do', 'Hand to agent'],
    [16, false, 'do', 'Hand to agent']
  ])
})

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
