// The conport CLI as the mod runs it, and how its answers read. The CLI reads the API key itself:
// the mod never touches it.
import { CLI_VERSION } from './version.js'

/** @import { Refused, Result } from './refusals.js' */

/**
 * Herdr's `exec`: runs a program and answers its code and its output.
 * @typedef {typeof import('herdr').exec} Exec
 */

/**
 * A milestone of an epic, as `epic list --json` gives it.
 * @typedef {{id: number, title: string, sequence?: number, is_release?: boolean, ready_to_close?: boolean, open_epics?: number}} Milestone
 */

/**
 * An epic of `epic list --json`: whether it can run and why not, whether it is ready to merge,
 * its milestone and how many of its tasks are open.
 * @typedef {{id: number, title: string, status?: string, runnable?: boolean, reason?: string | null, ready?: boolean, milestone?: Milestone | null, progress?: {total?: number, open?: number}}} Epic
 */

/**
 * What `epic list --json` answers.
 * @typedef {{project?: string, epics?: Epic[]}} EpicList
 */

/**
 * An epic of the tab Ready to run, with whether it is ready to merge.
 * @typedef {Epic & {ready: boolean}} LaunchEpic
 */

/**
 * An epic of the tab Prepare, with the document it lacks.
 * @typedef {Epic & {missing: 'spec' | 'plan' | null}} PrepareEpic
 */

/**
 * The runnable epics of one milestone, or of none.
 * @typedef {{milestone: Milestone | null, release: boolean, readyToClose: boolean, epics: LaunchEpic[]}} EpicGroup
 */

/**
 * The two tabs of epics.
 * @typedef {{project: string | null, launch: EpicGroup[], prepare: PrepareEpic[], counts: {launch: number, prepare: number}}} EpicTabs
 */

/**
 * What a task outside the epics is handed to an agent for.
 * @typedef {'do' | 'review' | 'fix'} HandMode
 */

/**
 * A task of `task list --json`.
 * @typedef {{id: number, title: string, status: string, priority?: number, kind?: string, changes_requested?: boolean}} Task
 */

/**
 * What `task list --json` answers.
 * @typedef {{project?: string, tasks?: Task[]}} TaskList
 */

/**
 * A task of the tab Tasks, with whether it is a bug and what it can be handed for.
 * @typedef {Task & {bug: boolean, mode: HandMode | null}} OutsideTask
 */

/**
 * The tab Tasks.
 * @typedef {{project: string | null, review: OutsideTask[], inProgress: OutsideTask[], todo: OutsideTask[], counts: {review: number, inProgress: number, todo: number, total: number}}} TaskTabs
 */

/**
 * A task of an epic.
 * @typedef {{id: number, title: string, status: string}} EpicTask
 */

/**
 * The tasks of an epic by status, and their total.
 * @typedef {{todo: number, inProgress: number, review: number, blocked: number, parked: number, done: number, total: number}} TaskCounts
 */

/** The limit of one CLI call: the first download of the package by npx takes longer than 30 s. */
export const CLI_TIMEOUT_MS = 300000

/** How many tasks of an epic one call of `conport api tasks list` asks for. */
const TASKS_PAGE = 200

/** @returns {Refused} */
const refused = (/** @type {string} */ code, /** @type {string} */ fact, action = '') => ({ ok: false, error: { code, fact, action } })

/** The text of a rejection of Herdr's exec. */
export const rejectionText = (/** @type {unknown} */ error) =>
  String(/** @type {{message?: unknown} | null | undefined} */ (error)?.message ?? error ?? '')

/** Herdr's exec rejected because its limit ran out (it rejects too when a program or a folder is missing). */
export const isTimeout = (/** @type {unknown} */ error) => /time[sd]?\s*out|timeout/i.test(rejectionText(error))

/**
 * A rejection of exec: the limit ran out, or the program could not start.
 * @param {unknown} error
 * @returns {Refused}
 */
function startFailure(error) {
  return refused(isTimeout(error) ? 'cli_timeout' : 'npx_missing', rejectionText(error))
}

/**
 * The JSON a command printed, undefined for none.
 * @param {string | null | undefined} text
 * @returns {any}
 */
function parseJson(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/**
 * The refusal object a --json command prints: `{"ok": false, "error": {code, message, action}}`.
 * @param {any} body
 * @returns {Refused | undefined}
 */
function asRefusal(body) {
  if (typeof body !== 'object' || body === null || body.ok !== false) return undefined
  const error = body.error
  if (typeof error !== 'object' || error === null) return undefined
  const text = (/** @type {unknown} */ value) => (typeof value === 'string' ? value : '')
  return refused(text(error.code) || 'refused', text(error.message), text(error.action))
}

/**
 * `<code>: <fact> — <action>`, the line a refusing command prints last to its error stream.
 * @param {string | undefined} stderr
 * @param {number | undefined} code
 * @returns {Refused}
 */
function refusalOfStderr(stderr, code) {
  const lines = String(stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1) ?? ''
  const match = /^([\w.-]+):\s*(.+?)\s+—\s+(.+)$/.exec(last)
  if (match) return refused(match[1], match[2], match[3])
  return refused('cli_failed', last || `exit code ${code}`)
}

/**
 * Runs `npx -y conport@<CLI_VERSION> <args>` in `cwd` through Herdr's `exec` and reads its JSON:
 * `{ok: true, data}`, or `{ok: false, error: {code, fact, action}}`.
 * @param {Exec} exec
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<Result<any>>}
 */
export async function runCli(exec, args, cwd) {
  let result
  try {
    result = await exec('npx', ['-y', `conport@${CLI_VERSION}`, ...args], { cwd, timeout: CLI_TIMEOUT_MS })
  } catch (error) {
    return startFailure(error)
  }
  const body = parseJson(result?.stdout)
  const refusal = asRefusal(body)
  if (refusal) return refusal
  if (result?.code !== 0) return refusalOfStderr(result?.stderr, result?.code)
  if (body === undefined) return refused('bad_output', 'the CLI answered with no JSON')
  return { ok: true, data: body }
}

export const epicListArgs = (/** @type {string} */ project) => ['epic', 'list', '-p', project, '--json']
export const taskListArgs = (/** @type {string} */ project) => ['task', 'list', '-p', project, '--json']

/** The subagent types of a harness: the options of the four roles of an epic. */
export const subagentsArgs = (/** @type {string} */ harness) => ['epic', 'subagents', '--harness', harness, '--json']

/**
 * What an epic that cannot run lacks, by the reason `epic list` gives; null for any other reason.
 * @param {string | null | undefined} reason
 * @returns {'spec' | 'plan' | null}
 */
export function missingDocument(reason) {
  return reason === 'no spec' ? 'spec' : reason === 'no plan' ? 'plan' : null
}

/**
 * The two tabs of epics from `epic list --json`: Ready to run — the runnable epics grouped by
 * milestone in the order of the roadmap, the epics outside a milestone last, each group with
 * whether its milestone is a release and is ready to close, each epic with `ready` (ready to
 * merge); Prepare — the others, each with the document it lacks.
 * @param {EpicList | null | undefined} list
 * @returns {EpicTabs}
 */
export function epicTabs(list) {
  const epics = Array.isArray(list?.epics) ? list.epics : []
  const runnable = epics.filter((epic) => epic.runnable === true)
  const prepare = epics.filter((epic) => epic.runnable !== true).map((epic) => ({ ...epic, missing: missingDocument(epic.reason) }))
  /** @type {EpicGroup[]} */
  const groups = []
  for (const epic of runnable) {
    const id = epic.milestone?.id ?? null
    let group = groups.find((g) => (g.milestone?.id ?? null) === id)
    if (!group) {
      group = {
        milestone: epic.milestone ?? null,
        release: epic.milestone?.is_release === true,
        readyToClose: epic.milestone?.ready_to_close === true,
        epics: []
      }
      groups.push(group)
    }
    group.epics.push({ ...epic, ready: epic.ready === true })
  }
  const order = (/** @type {EpicGroup} */ group) => (group.milestone === null ? Number.POSITIVE_INFINITY : Number(group.milestone.sequence ?? 0))
  groups.sort((a, b) => order(a) - order(b))
  return { project: list?.project ?? null, launch: groups, prepare, counts: { launch: runnable.length, prepare: prepare.length } }
}

/**
 * What a task outside the epics is handed to an agent for: a todo one to do, one in review to
 * review, one in progress that its review sent back to fix; null for one an agent is at.
 * @param {Task} task
 * @returns {HandMode | null}
 */
export function handMode(task) {
  if (task.status === 'TODO') return 'do'
  if (task.status === 'REVIEW') return 'review'
  return task.status === 'IN_PROGRESS' && task.changes_requested === true ? 'fix' : null
}

/** The button of each mode on the row of a task. */
export const HAND_BUTTONS = { do: 'Hand to agent', review: 'Review', fix: 'Fix' }

/**
 * The tab Tasks from `task list --json`: waiting for review, in progress, and to do by
 * priority (tasks of one priority in the order the server gave); each task with `bug` (its kind
 * is a behaviour defect) and `mode`, what it can be handed for.
 * @param {TaskList | null | undefined} list
 * @returns {TaskTabs}
 */
export function taskTabs(list) {
  const tasks = (Array.isArray(list?.tasks) ? list.tasks : []).map((task) => ({
    ...task,
    bug: task.kind === 'bug',
    mode: handMode(task)
  }))
  const review = tasks.filter((task) => task.status === 'REVIEW')
  const inProgress = tasks.filter((task) => task.status === 'IN_PROGRESS')
  const todo = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.status === 'TODO')
    .sort((a, b) => (a.task.priority ?? 99) - (b.task.priority ?? 99) || a.index - b.index)
    .map(({ task }) => task)
  return {
    project: list?.project ?? null,
    review,
    inProgress,
    todo,
    counts: { review: review.length, inProgress: inProgress.length, todo: todo.length, total: tasks.length }
  }
}

/**
 * A status of a task of an epic, as its counter says it.
 * @type {Record<string, string>}
 */
export const TASK_STATUS = {
  TODO: 'to do',
  IN_PROGRESS: 'in progress',
  REVIEW: 'in review',
  BLOCKED: 'blocked',
  PARKED: 'parked',
  DONE: 'done',
  CANCELLED: 'cancelled'
}

/**
 * The tasks of an epic by status; a cancelled one is in no count, nor in the total.
 * @param {{status: string}[] | null | undefined} tasks
 * @returns {TaskCounts}
 */
export function taskCounts(tasks) {
  const of = (/** @type {string} */ status) => (tasks ?? []).filter((task) => task.status === status).length
  const counts = {
    todo: of('TODO'),
    inProgress: of('IN_PROGRESS'),
    review: of('REVIEW'),
    blocked: of('BLOCKED'),
    parked: of('PARKED'),
    done: of('DONE')
  }
  return { ...counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) }
}

/**
 * The counts in one line, only the statuses some task is in: `1 in progress · 2 done`; empty
 * when no task counts.
 * @param {TaskCounts} counts
 * @returns {string}
 */
export function taskCountsLine(counts) {
  /** @type {[string, number][]} */
  const shown = [
    ['TODO', counts.todo],
    ['IN_PROGRESS', counts.inProgress],
    ['REVIEW', counts.review],
    ['BLOCKED', counts.blocked],
    ['PARKED', counts.parked],
    ['DONE', counts.done]
  ]
  return shown
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${TASK_STATUS[status]}`)
    .join(' · ')
}

/**
 * The tasks of an epic by number, the cancelled ones last.
 * @param {EpicTask[] | null | undefined} tasks
 * @returns {EpicTask[]}
 */
export function sortEpicTasks(tasks) {
  const last = (/** @type {EpicTask} */ task) => (task.status === 'CANCELLED' ? 1 : 0)
  return [...(tasks ?? [])].sort((a, b) => last(a) - last(b) || a.id - b.id)
}

/**
 * Every task of epic `epic`, whatever its status, the snoozed ones too: page after page.
 * @param {Exec} exec
 * @param {{epic: number, project: string, root: string}} where
 * @returns {Promise<Result<EpicTask[]>>}
 */
export async function readEpicTasks(exec, { epic, project, root }) {
  /** @type {EpicTask[]} */
  const tasks = []
  for (;;) {
    const page = await runCli(
      exec,
      [
        'api', 'tasks', 'list', '--parent_task_id', String(epic), '--status', 'ALL', '--include_snoozed', 'true',
        '--limit', String(TASKS_PAGE), '--offset', String(tasks.length), '--project', project
      ],
      root
    )
    if (page.ok === false) return page
    if (!Array.isArray(page.data?.tasks)) return refused('bad_output', 'the CLI answered with no list of tasks')
    tasks.push(...page.data.tasks.map((/** @type {EpicTask} */ { id, title, status }) => ({ id, title, status })))
    // A page that comes empty ends the reading: tasks removed meanwhile leave the total unreached.
    if (page.data.tasks.length === 0 || tasks.length >= (page.data.total ?? 0)) break
  }
  return { ok: true, data: sortEpicTasks(tasks) }
}
