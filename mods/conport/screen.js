// What the screens of the mod say, and what they decide without Herdr: the lines of an epic and
// of a task, the choices of the roles and of the agent of a sheet, and what the start of an epic
// shows. The words for the person are English; main.js only draws them.
import { TASK_STATUS } from './cli.js'
import { DEFAULT_ROLES, FIXER_TYPE } from './harness.js'
import { refusalLine } from './refusals.js'
import { holdState } from './session.js'

/** @import { Epic, EpicTask, HandMode, Milestone, Task } from './cli.js' */
/** @import { Place } from './git.js' */
/** @import { HarnessChoice, RoleKey, Roles } from './harness.js' */
/** @import { SheetKind } from './launch.js' */
/** @import { Result } from './refusals.js' */
/** @import { Hold, Session } from './session.js' */

/**
 * What `conport epic subagents --json` answers: whether the harness has typed subagents, and them.
 * @typedef {{typed?: boolean, subagents?: {type: string}[]}} Subagents
 */

/**
 * The lists of the four roles: the types of the harness to choose from, or why none can be
 * chosen; the roles a start sends.
 * @typedef {{on: true, types: string[], roles: Roles} | {on: false, note: string, roles: Roles}} RoleLists
 */

/**
 * A sheet that hands a preparation of an epic or a task outside the epics to an agent.
 * @typedef {{kind: 'spec' | 'plan', epic: Epic, task?: undefined} | {kind: HandMode, task: Task, epic?: undefined}} Sheet
 */

/**
 * A tab of the panel.
 * @typedef {keyof typeof TAB_TITLES} Tab
 */

/**
 * The English word for `n` things: `one` for exactly 1, `many` for any other count.
 * @param {number} n
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
export const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * What a release milestone holds: its open epics, or that it is ready to close.
 * @param {Milestone} milestone
 * @returns {string}
 */
export function releaseLine(milestone) {
  if (milestone.ready_to_close) return 'Release · ready to close'
  const n = milestone.open_epics ?? 0
  return `Release · ${n} ${plural(n, 'epic', 'epics')} open`
}

/** The group of the epics outside a milestone. */
export const NO_MILESTONE = 'No milestone'

/**
 * Where an epic stands: ready to merge by the field `ready`; in progress once it is taken or a
 * task is closed; else not started.
 * @param {Epic} epic
 * @returns {string}
 */
export function epicState(epic) {
  const total = epic.progress?.total ?? 0
  const closed = total - (epic.progress?.open ?? 0)
  if (epic.ready) return `Ready to merge · ${closed} of ${total} closed`
  if (epic.status === 'IN_PROGRESS' || closed > 0) return `In progress · ${closed} of ${total} closed`
  return `Not started · ${total} ${plural(total, 'task', 'tasks')}`
}

/** The three tabs. */
export const TAB_TITLES = { launch: 'Ready to run', prepare: 'Prepare', tasks: 'Tasks' }

/** A tab with its count. */
export const tabLabel = (/** @type {Tab} */ tab, /** @type {number} */ n) => `${TAB_TITLES[tab]} · ${n}`

/** What an epic that cannot start lacks, said on its row in the tab Prepare. */
export const PREPARE_STATE = {
  spec: 'No spec',
  plan: 'Spec, no plan',
  other: 'Not ready to run for another reason'
}

/** What Prepare does for an epic without a spec or a plan. */
export const PREPARE_HINT =
  'The agent talks the epic through with you and writes its spec and plan; then the epic appears in the Ready to run tab.'

/**
 * The groups of the tab Tasks, by the key of `taskTabs`.
 * @type {['review' | 'inProgress' | 'todo', string][]}
 */
export const TASK_GROUPS = [
  ['review', 'In review'],
  ['inProgress', 'In progress'],
  ['todo', 'To do']
]

/**
 * The priority of a task, 1 to 5, in words.
 * @type {Record<number, string>}
 */
export const PRIORITY = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Idle' }

/** The mark of a behaviour defect on its row. */
export const BUG_LABEL = 'Bug'

/**
 * A task outside the epics on its row: its priority while it waits, else its stage; a bug marked.
 * @param {Task} task
 * @returns {string}
 */
export function taskLine(task) {
  const stage =
    task.status === 'REVIEW'
      ? 'In review'
      : task.status === 'IN_PROGRESS'
      ? task.changes_requested
        ? 'Changes requested'
        : 'In progress'
      : `${PRIORITY[task.priority] ?? 'No priority'} · not started`
  return task.kind === 'bug' ? `${BUG_LABEL} · ${stage}` : stage
}

/**
 * The mark at the left of a task of an epic, named by the theme's state color it is drawn in:
 * `done`, `working` (in progress or in review), `blocked`, or `idle` (to do, parked, cancelled).
 * @typedef {'done' | 'working' | 'blocked' | 'idle'} TaskMark
 */

/** @type {Record<string, TaskMark>} */
const TASK_MARKS = { DONE: 'done', IN_PROGRESS: 'working', REVIEW: 'working', BLOCKED: 'blocked' }

/**
 * A task of an epic on its row, as the epics of the tab Ready to run: the title, a line under it
 * with the number and the status, the mark of the status; a cancelled one dimmed.
 * @param {EpicTask} task
 * @returns {{title: string, line: string, mark: TaskMark, muted: boolean}}
 */
export function epicTaskRow(task) {
  return {
    title: task.title,
    line: `#${task.id} · ${TASK_STATUS[task.status] ?? task.status}`,
    mark: TASK_MARKS[task.status] ?? 'idle',
    muted: task.status === 'CANCELLED'
  }
}

/** The four roles of an epic, in the order of the screen. */
export const ROLE_KEYS = /** @type {RoleKey[]} */ (Object.keys(DEFAULT_ROLES))

export const ROLE_TITLES = {
  implementer: 'Implementer',
  reviewer: 'Reviewer',
  gapHunter: 'Gap hunter',
  finalReviewer: 'Final reviewer'
}

/** Under the roles: who fixes what a review found is not chosen. */
export const FIXER_NOTE = `Fixes: the same implementer, otherwise ${FIXER_TYPE}`

/** Why the role lists are off for a harness whose subagents have no types (Codex, Cursor). */
export const ROLES_UNTYPED_NOTE = 'This harness has no typed subagents: the roles follow the texts of conport agent <role>'

/** Why the role lists are off for a harness that is not installed. */
export const ROLES_NO_HARNESS_NOTE = 'Harness not found: its subagent types cannot be read'

/** Why the role lists are off when the types cannot be read: the refusal with its action. */
export const rolesUnavailableNote = (/** @type {string} */ line) => `The subagent list is unavailable, so the roles keep their default types: ${line}`

/** Beside a role whose type the list of the harness lacks. */
export const TYPE_MISSING_NOTE = 'Type not found — install or update the conport plugin.'

/** Under Start when the copy of the epic is there and no agent is in it. */
export const COPY_NOTE = 'The working copy is already there: the agent resumes where the work stopped'

/** On the screen of an epic whose copy is there: a session in Orca is not seen here. */
export const ORCA_NOTE = 'If a session in Orca runs this epic, do not start a second one'

/** No agent a sheet can open is installed. */
export const NO_AGENT =
  'Only Claude Code, Codex and Cursor take a task, and none of them was found — install one of them and press Refresh.'

/** Under the buttons of an epic. */
export const QUESTIONS_NOTE = 'The lead session asks its questions in its own terminal; Herdr calls you'

/** What a start again does while the session of the epic is alive: asked before it. */
export const RESTART_NOTE =
  "The epic's session is live. A new start opens one more lead tab with the same task; the old one stays open."

/** A harness or an agent as its choice says it: one that is not installed says so. */
export const harnessLabel = (/** @type {HarnessChoice} */ choice) => (choice.installed ? choice.label : `${choice.label} — not found`)

/**
 * The lists of the four roles: `{on: true, types, roles}` with the subagent types of the harness
 * as options, or `{on: false, note, roles}` with why none can be chosen, the roles then the
 * defaults (what a start sends); null while the types are read. `answer` is what
 * `conport epic subagents` answered for the harness, undefined before it did.
 * @param {{installed: boolean, answer: Result<Subagents> | undefined, roles: Partial<Roles>}} read
 * @returns {RoleLists | null}
 */
export function roleLists({ installed, answer, roles }) {
  if (!installed) return { on: false, note: ROLES_NO_HARNESS_NOTE, roles: { ...DEFAULT_ROLES } }
  if (answer === undefined) return null
  if (answer.ok === false) return { on: false, note: rolesUnavailableNote(refusalLine(answer.error)), roles: { ...DEFAULT_ROLES } }
  if (answer.data?.typed !== true) return { on: false, note: ROLES_UNTYPED_NOTE, roles: { ...DEFAULT_ROLES } }
  const types = (answer.data.subagents ?? []).map((subagent) => subagent.type)
  return { on: true, types, roles: { ...DEFAULT_ROLES, ...roles } }
}

/**
 * One role of `lists`: its type, the options, and whether the type is missing from the list of
 * the harness (it keeps its place, first in the options).
 * @param {RoleLists} lists
 * @param {RoleKey} key
 * @returns {{value: string, types: string[], missing: boolean}}
 */
export function roleChoice(lists, key) {
  const value = lists.roles[key]
  if (!lists.on) return { value, types: [value], missing: false }
  const missing = !lists.types.includes(value)
  return { value, types: missing ? [value, ...lists.types] : lists.types, missing }
}

/**
 * The agent a sheet opens with: the one of last time while it is installed, else the first installed.
 * @param {HarnessChoice[] | null | undefined} choices
 * @param {unknown} last
 * @returns {string | null}
 */
export function sheetAgent(choices, last) {
  const installed = (choices ?? []).filter((choice) => choice.installed)
  return (installed.find((choice) => choice.kind === last) ?? installed[0])?.kind ?? null
}

/** What the agent opened from a sheet does, step by step. */
export const SHEET_STEPS = {
  spec: [
    'Talks the epic through with you and writes the spec',
    'After your yes, uploads it to ConPort',
    "Writes the plan, links the epic's tasks, imports the plan"
  ],
  plan: [
    "Reads the epic's spec and talks the plan through with you",
    "Links the epic's open tasks to the plan",
    'After your yes, imports the plan into ConPort'
  ],
  do: [
    'Starts the task',
    'Does it on its own branch, in a separate working copy beside the repository, checks it and commits',
    "Writes a report with the branch and the commit to the task's journal; the task goes to review"
  ],
  review: [
    "Reads the task's journal: brief, report, fixes",
    'Reviews the branch from the report',
    "Writes a review with a verdict to the task's journal; on approval, with your consent, closes the task"
  ],
  fix: [
    "Reads the task's journal and its latest review with the findings",
    "Continues on the task's branch, fixes and commits",
    "Writes the fixes to the task's journal; the task goes to review again"
  ]
}

const HAND_SHEETS = {
  do: { button: 'Hand to agent', who: 'Who takes the task' },
  review: { button: 'Review', who: 'Who reviews' },
  fix: { button: 'Fix', who: 'Who fixes' }
}

/**
 * The title, the line under it, who is chosen and the button of a sheet.
 * @param {Sheet} sheet
 * @returns {{title: string, description: string, who: string, button: string}}
 */
export function sheetText(sheet) {
  if (sheet.kind === 'spec' || sheet.kind === 'plan') {
    const button = sheet.kind === 'spec' ? 'Prepare' : 'Write plan'
    return {
      title: `${button} “${sheet.epic.title}”`,
      description: `${sheet.epic.id} · ${sheet.kind === 'spec' ? 'no spec' : 'no plan'}`,
      who: 'Who prepares',
      button
    }
  }
  const { button, who } = HAND_SHEETS[sheet.kind]
  const stage = taskLine({ ...sheet.task, kind: 'task' }).toLowerCase()
  return { title: `${button} “${sheet.task.title}”`, description: `${sheet.task.id} · ${stage}`, who, button }
}

/** Where the lead session of an epic was opened. */
export const startNotice = (/** @type {number} */ epic) => `The agent of epic ${epic} is open in the lead tab of space epic-${epic}; it asks its questions there`

/**
 * Where the agent of a sheet was opened (`kind` and `id` of the sheet), and what comes of it.
 * @param {{kind: SheetKind, id: number, project: string}} sheet
 * @returns {string}
 */
export function handNotice({ kind, id, project }) {
  if (kind === 'spec' || kind === 'plan') {
    return `Preparation of epic ${id} is open in tab prepare-${id} of project “${project}”: the agent is waiting for you there. Once the plan is in ConPort, press Refresh.`
  }
  const tab = `in tab task-${id} of project “${project}”`
  if (kind === 'fix') {
    return `Fixes of task ${id} are open ${tab}: the agent is waiting for you there. Once it writes its fixes to the journal, the task waits for review again; press Refresh.`
  }
  if (kind === 'review') {
    return `Review of task ${id} is open ${tab}: the agent writes its verdict to the task's journal and, on approval, closes the task with your consent.`
  }
  return `Task ${id} is open ${tab}: the agent is waiting for you there. The work goes to a separate branch of the task, and you merge it. Once the agent writes its report, the task waits for review; press Refresh.`
}

/**
 * What the start of an epic shows: whether its session is live (Show and Start again)
 * or not (Start), whether the start is off, and the lines under the buttons. `place` is
 * where the epic runs as read when it was opened, `hold` the wait after a start, `ready` whether
 * everything a start needs is there.
 * @param {{session: Session | null | undefined, hold: Hold | null, place: Result<Place> | null, ready: boolean}} start
 * @returns {{live: boolean, disabled: boolean, lines: string[]}}
 */
export function startView({ session, hold, place, ready }) {
  const live = session?.live === true
  const held = holdState(hold, session)
  const copy = place?.ok === true && place.data.copy === 'existing'
  const lines = []
  if (!live) {
    if (held.line !== null) lines.push(held.line)
    else if (copy) lines.push(COPY_NOTE)
  }
  if (copy) lines.push(ORCA_NOTE)
  lines.push(QUESTIONS_NOTE)
  return { live, disabled: !ready || held.disabled, lines }
}
