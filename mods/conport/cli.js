// The conport CLI as the mod runs it, and how its answers read. The CLI reads the API key itself:
// the mod never touches it.
import { CLI_VERSION } from './version.js'

/** @import { Refused, Result } from './refusals.js' */

/**
 * Herdr's `exec`: runs a program and answers its code and its output.
 * @typedef {typeof import('herdr').exec} Exec
 */

/**
 * A milestone of an epic, as `sdd list --json` gives it.
 * @typedef {{id: number, title: string, sequence?: number, is_release?: boolean, ready_to_close?: boolean, open_epics?: number}} Milestone
 */

/**
 * The epics of one milestone, or of none, of a section of `sdd list`.
 * @template [E=InWorkRow]
 * @typedef {{milestone: Milestone | null, release: boolean, readyToClose: boolean, epics: E[]}} EpicGroup
 */

/**
 * The status of an open task, as `sdd list --json` gives it.
 * @typedef {'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED'} Status
 */

/**
 * The person who leads a task, as `sdd list --json` names one: the handle, the email when the
 * person has one, and whether the person has left the team.
 * @typedef {{handle: string, email: string | null, former_member: boolean}} Assignee
 */

/**
 * Who leads a row: null for nobody; absent in a Private Team and from a CLI older than the field.
 * @typedef {{assignee?: Assignee | null}} Led
 */

/**
 * An epic of the section In work: a spec and a plan; `spec` and `idea` are the spec it was
 * planned from and the idea that spec clarifies; `updated_at` only for one in progress.
 * @typedef {{id: number, title: string, status: string, updated_at?: string, progress: {open: number, total: number}, milestone: Milestone | null, ready: boolean, reason: string | null, spec: number | null, idea: number | null} & Led} InWorkRow
 */

/**
 * A spec of the section Specs: a document waiting for its plan (`epic` null, `status` null), or
 * an epic with a spec and no plan; `idea` the task it clarifies, `priority` its priority.
 * @typedef {{doc: number, title: string, idea: number | null, priority: number, epic: number | null, status: string | null, updated_at?: string} & Led} SpecRow
 */

/**
 * An idea, a root task with no spec; or, the same shape, a task of an epic outside SDD.
 * @typedef {{id: number, kind: 'task' | 'bug', title: string, status: Status, updated_at?: string, priority: number, changes_requested: boolean} & Led} IdeaRow
 */

/**
 * A proposal of the team, a document waiting for an answer.
 * @typedef {{doc: number, title: string, author: string | null}} ProposalRow
 */

/**
 * An epic with no spec, with its open tasks.
 * @typedef {{id: number, title: string, status: string, updated_at?: string, milestone: Milestone | null, progress: {open: number, total: number}, tasks: IdeaRow[]} & Led} OutsideRow
 */

/**
 * What `sdd list --json` answers; `me` the caller's handle (null when the CLI could not name the
 * caller; absent in a Private Team).
 * @typedef {{project?: string, in_work?: InWorkRow[], specs?: SpecRow[], ideas?: IdeaRow[], proposals?: ProposalRow[], skipped_proposals?: {doc: number, reason: string}[], outside?: OutsideRow[], unlisted?: number[], me?: string | null}} SddList
 */

/**
 * What `sdd list --taken --json` answers: the root tasks in progress, each with who leads it.
 * @typedef {{project?: string, taken?: ({id: number, kind: 'task' | 'bug' | 'epic', updated_at: string} & Led)[]}} SddTaken
 */

/**
 * A row in progress of the list (`taken`): an agent is at it, and it offers no start.
 * @typedef {{taken: boolean}} Taken
 */

/**
 * An idea, or a task outside SDD, with what it can be handed for (`mode`).
 * @typedef {IdeaRow & {mode: HandMode | null}} HandRow
 */

/**
 * The four sections of `sdd list`: In work and Outside SDD by milestone in the order of the
 * roadmap, Specs, and Ideas with the proposals among them; `skipped` the proposals the CLI
 * could not read.
 * @typedef {{project: string | null, inWork: EpicGroup<InWorkRow & Taken>[], specs: (SpecRow & Taken)[], ideas: Array<(HandRow & Taken) | ProposalRow>, skipped: number, outside: EpicGroup<Omit<OutsideRow, 'tasks'> & Taken & {tasks: HandRow[]}>[]}} SddSections
 */

/**
 * What an idea or a task of an epic outside SDD is handed to an agent for.
 * @typedef {'do' | 'review' | 'fix'} HandMode
 */

/**
 * A task as its row and its sheet read it.
 * @typedef {{id: number, title: string, status: string, priority?: number, kind?: string, changes_requested?: boolean}} Task
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

/** The subagent types of a harness: the options of the four roles of an epic. */
export const subagentsArgs = (/** @type {string} */ harness) => ['epic', 'subagents', '--harness', harness, '--json']

/** The project, whose address `canonical_name` (`<team>/<name>`) names its team: Open spec reads it. */
export const projectGetArgs = (/** @type {string} */ project) => ['api', 'projects', 'get', '--project', project]

/**
 * Epics grouped by milestone in the order of the roadmap, the epics outside a milestone last,
 * each group with whether its milestone is a release and is ready to close; the epics of a group
 * in the order given.
 * @template {{milestone?: Milestone | null}} E
 * @param {E[]} epics
 * @returns {EpicGroup<E>[]}
 */
function byMilestone(epics) {
  /** @type {EpicGroup<E>[]} */
  const groups = []
  for (const epic of epics) {
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
    group.epics.push(epic)
  }
  const order = (/** @type {EpicGroup<E>} */ group) => (group.milestone === null ? Number.POSITIVE_INFINITY : Number(group.milestone.sequence ?? 0))
  return groups.sort((a, b) => order(a) - order(b))
}

/** The stages of the project: `sdd list --json`. */
export const sddListArgs = (/** @type {string} */ project) => ['sdd', 'list', '-p', project, '--json']

/** The light read of the minute: the root tasks in progress, `sdd list --taken --json`. */
export const sddTakenArgs = (/** @type {string} */ project) => ['sdd', 'list', '--taken', '-p', project, '--json']

/** The priority a proposal counts as among the ideas. */
const PROPOSAL_PRIORITY = 3

/**
 * A row in progress is taken: an agent is at it. An idea back from review is in progress too,
 * but it waits for its fix (`changes_requested`), and nobody is at it.
 * @param {{status?: string | null, changes_requested?: boolean}} row
 * @returns {boolean}
 */
const isTaken = (row) => row.status === 'IN_PROGRESS' && row.changes_requested !== true

/**
 * The four sections of `sdd list --json`: In work and Outside SDD grouped by milestone in the
 * order of the roadmap, the epics outside a milestone last; Specs as the CLI orders them; Ideas
 * by priority, then number, a proposal counted as priority 3 after the ideas of that priority,
 * the proposals by number. Each epic, spec of an epic and idea says whether the list holds it
 * `taken` (the light read of the minute then marks the taken rows by its own set); each
 * idea and task outside SDD its `mode`, what it can be handed for — an idea back from review is
 * handed to fix, not taken.
 * @param {SddList | null | undefined} list
 * @returns {SddSections}
 */
export function sddSections(list) {
  const rows = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : [])
  /** @type {(row: IdeaRow) => HandRow} */
  const hand = (row) => ({ ...row, mode: handMode(row) })
  const ideas = rows(list?.ideas)
    .map((/** @type {IdeaRow} */ row, /** @type {number} */ index) => ({ row: { ...hand(row), taken: isTaken(row) }, index }))
    .sort((a, b) => a.row.priority - b.row.priority || a.row.id - b.row.id || a.index - b.index)
    .map(({ row }) => row)
  const proposals = [.../** @type {ProposalRow[]} */ (rows(list?.proposals))].sort((a, b) => a.doc - b.doc)
  const at = ideas.findIndex((row) => row.priority > PROPOSAL_PRIORITY)
  const cut = at === -1 ? ideas.length : at
  return {
    project: list?.project ?? null,
    inWork: byMilestone(rows(list?.in_work).map((/** @type {InWorkRow} */ epic) => ({ ...epic, ready: epic.ready === true, taken: isTaken(epic) }))),
    specs: rows(list?.specs).map((/** @type {SpecRow} */ spec) => ({ ...spec, taken: spec.epic !== null && isTaken(spec) })),
    ideas: [...ideas.slice(0, cut), ...proposals, ...ideas.slice(cut)],
    skipped: rows(list?.skipped_proposals).length,
    outside: byMilestone(
      rows(list?.outside).map((/** @type {OutsideRow} */ epic) => ({ ...epic, taken: isTaken(epic), tasks: rows(epic.tasks).map(hand) }))
    )
  }
}

/**
 * The rows of the list that the light read can hold, with their status: the root tasks — the epics
 * In work, the epics of Specs, the ideas and the epics outside SDD; not the spec documents, the
 * proposals, nor the tasks of an epic.
 * @param {SddList} list
 * @returns {{id: number, status: string | null | undefined}[]}
 */
function rootRows(list) {
  const rows = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : [])
  return [
    ...rows(list.in_work).map((/** @type {InWorkRow} */ epic) => ({ id: epic.id, status: epic.status })),
    ...rows(list.specs)
      .filter((/** @type {SpecRow} */ spec) => spec.epic !== null && spec.epic !== undefined)
      .map((/** @type {SpecRow} */ spec) => ({ id: Number(spec.epic), status: spec.status })),
    ...rows(list.ideas).map((/** @type {IdeaRow} */ idea) => ({ id: idea.id, status: idea.status })),
    ...rows(list.outside).map((/** @type {OutsideRow} */ epic) => ({ id: epic.id, status: epic.status }))
  ]
}

/**
 * Whether the light read `taken` says the last full list is out of date: a taken
 * number that is no row of the list, or a row the list holds in progress that the light read no
 * longer lists. A row of the list taken meanwhile asks for nothing: the light read marks it
 * taken by itself. The light read reads the root tasks only, so a task of an epic in progress
 * asks for nothing either. A number the list read and shows nowhere (`unlisted`: an idea a spec
 * clarifies) is known, and its leaving the light read asks for nothing. No list or no light
 * read: read in full.
 * @param {SddList | null | undefined} list
 * @param {SddTaken | null | undefined} taken
 * @returns {boolean}
 */
export function needsFullRead(list, taken) {
  if (!list || !taken) return true
  const now = new Set((Array.isArray(taken.taken) ? taken.taken : []).map((row) => row.id))
  const rows = rootRows(list)
  const known = new Set([...rows.map((row) => row.id), ...(Array.isArray(list.unlisted) ? list.unlisted : [])])
  for (const id of now) if (!known.has(id)) return true
  return rows.some((row) => row.status === 'IN_PROGRESS' && !now.has(row.id))
}

/**
 * What an idea or a task of an epic outside SDD is handed to an agent for: a todo one to do, one in review to
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
