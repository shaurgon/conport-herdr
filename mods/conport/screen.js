// What the screens of the mod say, and what they decide without Herdr: the four sections of the
// SDD stages, the lines and the buttons of their rows, when the list is read again, the choices of
// the roles and of the agent of a sheet, and what the start of an epic shows. The words for the
// person are English; main.js only draws them.
import { HAND_BUTTONS, TASK_STATUS } from './cli.js'
import { DEFAULT_ROLES, FIXER_TYPE } from './harness.js'
import { refusalLine } from './refusals.js'
import { holdState } from './session.js'

/** @import { Assignee, EpicTask, HandMode, IdeaRow, InWorkRow, Milestone, ProposalRow, SddTaken, SpecRow, Task } from './cli.js' */
/** @import { Place } from './git.js' */
/** @import { HarnessChoice, RoleKey, Roles } from './harness.js' */
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
 * A sheet: what an agent is opened on — an idea to brainstorm, a proposal to brainstorm, a spec to
 * plan and build, a task to do, review or fix — or a proposal to decline, which opens no agent.
 * `takeOver`: the person said yes to taking over an idea or the epic of a spec another person leads.
 * @typedef {{kind: 'idea', idea: IdeaRow, takeOver?: boolean} | {kind: 'proposal', proposal: ProposalRow} | {kind: 'decline', proposal: ProposalRow} | {kind: 'spec', spec: SpecRow, takeOver?: boolean} | {kind: HandMode, task: Task}} Sheet
 */

/**
 * The kind of a sheet.
 * @typedef {Sheet['kind']} SheetKind
 */

/**
 * A section of the screen.
 * @typedef {'in_work' | 'specs' | 'ideas' | 'outside'} SectionKey
 */

/**
 * A row of a section as its line and its buttons read it: an idea, a proposal, a spec (a document
 * or an epic with a spec and no plan), an epic In work or outside SDD, or a task of an epic outside SDD.
 * @typedef {({type: 'idea' | 'task', mode: HandMode | null} & Pick<IdeaRow, 'status'> & Partial<Pick<IdeaRow, 'kind' | 'priority' | 'changes_requested'>>)
 *   | ({type: 'proposal'} & Partial<Pick<ProposalRow, 'author'>>)
 *   | ({type: 'spec'} & Pick<SpecRow, 'epic'> & Partial<Pick<SpecRow, 'priority'>>)
 *   | ({type: 'epic', section: 'in_work' | 'outside', reason?: string | null} & Pick<InWorkRow, 'status' | 'progress'> & Partial<Pick<InWorkRow, 'ready'>>)} ActionRow
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
 * @param {{ready?: boolean, status?: string | null, progress?: {total?: number, open?: number}}} epic
 * @returns {string}
 */
export function epicState(epic) {
  const total = epic.progress?.total ?? 0
  const closed = total - (epic.progress?.open ?? 0)
  if (epic.ready) return `Ready to merge · ${closed} of ${total} closed`
  if (epic.status === 'IN_PROGRESS' || closed > 0) return `In progress · ${closed} of ${total} closed`
  return `Not started · ${total} ${plural(total, 'task', 'tasks')}`
}

/**
 * The four sections, top to bottom: the nearer to a release, the higher. Each opens as the spec
 * says until the person folds or opens it; Outside SDD starts folded.
 * @type {{key: SectionKey, title: string, caption: string, open: boolean}[]}
 */
export const SECTIONS = [
  { key: 'in_work', title: 'In work', caption: 'spec + plan', open: true },
  { key: 'specs', title: 'Specs', caption: 'spec, no plan', open: true },
  { key: 'ideas', title: 'Ideas', caption: 'not worked through', open: true },
  { key: 'outside', title: 'Outside SDD', caption: 'no spec', open: false }
]

/** The title of each section by its key. */
export const SECTION_TITLES = /** @type {Record<SectionKey, string>} */ (Object.fromEntries(SECTIONS.map((section) => [section.key, section.title])))

/** A section's title with its count. */
export const sectionLabel = (/** @type {SectionKey} */ key, /** @type {number} */ n) => `${SECTION_TITLES[key]} · ${n}`

/**
 * Which sections are open: what `kept` (the value the mod stored) says of a section, as a
 * boolean, else as the spec opens it.
 * @param {unknown} kept
 * @returns {Record<SectionKey, boolean>}
 */
export function sectionsOpen(kept) {
  const said = /** @type {Record<string, unknown>} */ (kept !== null && typeof kept === 'object' ? kept : {})
  return /** @type {Record<SectionKey, boolean>} */ (
    Object.fromEntries(SECTIONS.map((section) => [section.key, typeof said[section.key] === 'boolean' ? said[section.key] : section.open]))
  )
}

/** Under Ideas: the proposals `sdd list` could not read. */
export const skippedLine = (/** @type {number} */ n) =>
  n === 1 ? '1 proposal is not shown: its state line cannot be read' : `${n} proposals are not shown: their state lines cannot be read`

/** How often the light read of the taken rows runs while the mod is open. */
export const POLL_TAKEN_MS = 60000

/** How long the full list stands before the timer reads it again. */
export const FULL_READ_MS = 600000

/**
 * What a tick of the timer reads: nothing while a read runs; the full list once `FULL_READ_MS`
 * passed since the last one; else the light read of the taken rows.
 * @param {{reading: boolean, sinceFull: number}} state
 * @returns {'none' | 'full' | 'taken'}
 */
export function pollStep({ reading, sinceFull }) {
  if (reading) return 'none'
  return sinceFull >= FULL_READ_MS ? 'full' : 'taken'
}

/**
 * The taken rows of the light read by number, with the time each was last changed; null for no
 * light read since the last full one.
 * @param {SddTaken | null | undefined} taken
 * @returns {Map<number, string> | null}
 */
export function takenMap(taken) {
  if (!taken) return null
  return new Map((Array.isArray(taken.taken) ? taken.taken : []).map((row) => [row.id, row.updated_at]))
}

/**
 * Whether a row of the list is taken: by the light read when there is one since the last full
 * read — its number in the set, and not an idea back from review, which waits for its fix — else
 * as the full list says. `id` is the number the light read knows the row by (the epic of a spec).
 * @param {{id?: number | null, taken?: boolean, changes_requested?: boolean}} row
 * @param {Map<number, string> | null} taken
 * @returns {boolean}
 */
export function rowTaken(row, taken) {
  if (taken === null) return row.taken === true
  return typeof row.id === 'number' && taken.has(row.id) && row.changes_requested !== true
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (/** @type {number} */ n) => String(n).padStart(2, '0')

/**
 * A taken row by the time it was last changed, in the time of this machine: `In progress · updated
 * HH:MM` today, `In progress · updated D Mon HH:MM` on another day; no time when there is none.
 * @param {string | null | undefined} iso
 * @param {Date} now
 * @returns {string}
 */
export function updatedLine(iso, now) {
  const at = new Date(iso ?? '')
  if (iso === null || iso === undefined || Number.isNaN(at.getTime())) return 'In progress'
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`
  const today = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  return today ? `In progress · updated ${time}` : `In progress · updated ${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`
}

/** What Take over asks before it starts a row another session may be at. */
export const TAKE_OVER_CONFIRM = 'Another session may be working on it'

/**
 * A person as the mod names one: by the email, else by the handle — a handle alone names no colleague.
 * @param {Assignee} person
 * @returns {string}
 */
export const personName = (person) => person.email || person.handle

/**
 * The person who leads a row when that is someone else: null for a row of the caller's (its
 * handle is `me`) or of nobody, and for every row while the caller is unknown (`me` null: the CLI
 * could not name it) — as in the dashboard, nobody is another person then.
 * @param {Assignee | null | undefined} assignee
 * @param {string | null | undefined} me
 * @returns {Assignee | null}
 */
export function ledByOther(assignee, me) {
  if (assignee === null || assignee === undefined) return null
  if (me === null || me === undefined) return null
  return assignee.handle === me ? null : assignee
}

/**
 * What Take over of a row asks: a row another person leads (`lead`) by that person's name, and
 * its yes lets the agent take the task over (`takeOver`); any other row as before.
 * @param {{title: string, lead: Assignee | null}} row
 * @returns {{title: string, text: string, takeOver: boolean}}
 */
export function takeOverAsk({ title, lead }) {
  if (lead === null) return { title: `Take over “${title}”?`, text: TAKE_OVER_CONFIRM, takeOver: false }
  return { title: `${personName(lead)} leads this task. Take it over?`, text: `“${title}”`, takeOver: true }
}

/**
 * The yes to a Take over: the start it asked about runs, told whether it takes the row over from
 * another person.
 * @template C
 * @param {{title: string, lead: Assignee | null, go: (cx: C, takeOver: boolean) => void}} pending
 * @param {C} cx
 */
export function answerTakeOver(pending, cx) {
  pending.go(cx, takeOverAsk(pending).takeOver)
}

/**
 * The sheet a start of an idea or of a spec opens: with `takeOver` after a yes to taking over a
 * row another person leads, else as it is.
 * @template {Sheet} S
 * @param {S} sheet
 * @param {boolean} takeOver
 * @returns {S}
 */
export const takeOverSheet = (sheet, takeOver) => (takeOver ? /** @type {S} */ ({ ...sheet, takeOver: true }) : sheet)

/**
 * The key of the start of epic `epic` of the repository `gitDir`: `<git dir>:<epic>`.
 * @param {string} gitDir
 * @param {number} epic
 * @returns {string}
 */
export const epicStartKey = (gitDir, epic) => `${gitDir}:${epic}`

/**
 * What changes which epic, by `<git dir>:<epic>`, a start takes over from another person: `yes`
 * — the person said yes to a Take over of the epic (`takeOver` when another person leads it);
 * `open` — its screen opened by a press of its row; `close` — its screen closed; `project` —
 * another project read; `started` — the start of `key` went out.
 * @typedef {{kind: 'yes', gitDir: string | null, epic: number, takeOver: boolean} | {kind: 'open' | 'close' | 'project'} | {kind: 'started', key: string}} EpicTakeOverEvent
 */

/**
 * The epic a start takes over after `event`, `current` the one before it: only a yes to taking
 * over an epic another person leads names one, and it holds until that epic starts, its screen
 * opens by a press or closes, or another project is read.
 * @param {string | null} current
 * @param {EpicTakeOverEvent} event
 * @returns {string | null}
 */
export function takeOverEpicAfter(current, event) {
  switch (event.kind) {
    case 'yes':
      return event.takeOver && event.gitDir !== null ? epicStartKey(event.gitDir, event.epic) : null
    case 'started':
      return current === event.key ? null : current
    default:
      return null
  }
}

/**
 * The buttons of a row, by the table of the spec: an idea to do — Brainstorm; an idea or an epic
 * taken — Show terminal when this host has its terminal (`hasTab`), else Take over, whatever stage
 * the list still holds; an idea in review or back from it — Review or Fix; a blocked idea — none; a proposal — Brainstorm and Decline; a
 * spec — Plan & build (Show terminal or Take over the same way) and Open spec; an epic In work —
 * Start; a task of an epic outside SDD — Hand to agent, Review or Fix.
 * @param {ActionRow} row
 * @param {boolean} taken
 * @param {boolean} hasTab
 * @returns {string[]}
 */
export function rowActions(row, taken, hasTab) {
  const launch = (/** @type {string} */ start) => (hasTab ? 'Show terminal' : taken ? 'Take over' : start)
  switch (row.type) {
    case 'proposal':
      return ['Brainstorm', 'Decline']
    case 'spec':
      return [launch('Plan & build'), 'Open spec']
    case 'epic':
      if (row.section === 'outside' || row.reason) return []
      return [launch('Start')]
    case 'task':
      return row.mode === null ? [] : [HAND_BUTTONS[row.mode]]
    default:
      // In the order `rowLine` says it: taken first — the light read is newer than the stage the
      // list holds — then in review or back from it, then blocked.
      if (taken) return [launch('Brainstorm')]
      if (row.mode === 'fix' || row.mode === 'review') return [HAND_BUTTONS[row.mode]]
      if (row.status === 'BLOCKED') return []
      if (hasTab) return ['Show terminal']
      return row.status === 'TODO' ? ['Brainstorm'] : []
  }
}

/**
 * The line under the title of a row: a taken row by the time it was last changed (`updated`, as
 * `now` sees it); else an idea or a task by its stage (`Blocked` for a blocked one), a proposal by
 * its author, a spec by what it waits for, an epic In work by where it stands (ready to merge
 * before anything, why it cannot start), an epic outside SDD by its closed tasks; then who leads
 * it (`assignee`), when someone does.
 * @param {ActionRow} row
 * @param {{taken: boolean, updated?: string | null, now?: Date, assignee?: Assignee | null}} state
 * @returns {string}
 */
export function rowLine(row, { taken, updated = null, now = new Date(), assignee = null }) {
  const line = stageLine(row, taken, updatedLine(updated, now))
  return assignee ? `${line} · ${personName(assignee)}` : line
}

/**
 * The stage a row says, `progress` the line of a taken one.
 * @param {ActionRow} row
 * @param {boolean} taken
 * @param {string} progress
 * @returns {string}
 */
function stageLine(row, taken, progress) {
  switch (row.type) {
    case 'proposal':
      return row.author ? `Proposal · ${row.author}` : 'Proposal'
    case 'spec':
      if (taken) return progress
      return row.epic === null || row.epic === undefined ? `${PRIORITY[row.priority] ?? 'No priority'} · no plan` : `Epic ${row.epic} · no plan`
    case 'epic': {
      if (row.section === 'in_work') {
        if (row.ready) return epicState(row)
        if (row.reason) return `Cannot start: ${row.reason}`
        return taken ? progress : epicState(row)
      }
      if (taken) return progress
      const total = row.progress?.total ?? 0
      return `${total - (row.progress?.open ?? 0)} of ${total} closed`
    }
    default: {
      const bug = (/** @type {string} */ stage) => (row.kind === 'bug' ? `${BUG_LABEL} · ${stage}` : stage)
      if (taken) return bug(progress)
      if (row.status === 'BLOCKED') return bug('Blocked')
      return taskLine({ id: 0, title: '', status: row.status, priority: row.priority, kind: row.kind, changes_requested: row.changes_requested })
    }
  }
}

/** The address of the dashboard. */
const DASHBOARD = 'https://me.conport.app'

/**
 * Open spec: document `doc` in the dashboard, in the team `canonical` (the project's address
 * `<team>/<name>`) names; null when the address names no team.
 * @param {{canonical: string | null | undefined, handle: string, doc: number}} where
 * @returns {string | null}
 */
export function documentUrl({ canonical, handle, doc }) {
  const team = typeof canonical === 'string' && canonical.includes('/') ? canonical.split('/')[0] : ''
  if (team === '') return null
  return `${DASHBOARD}/t/${encodeURIComponent(team)}/p/${encodeURIComponent(handle)}/documents?id=${doc}`
}

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
 * A task of an epic on its row, as the epics In work: the title, a line under it
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

/** What the agent opened from a sheet does, step by step; a decline opens no agent. */
export const SHEET_STEPS = {
  idea: [
    'Takes the idea and reads its journal and links',
    'Talks it through with you: a small fix, a look around, or a spec',
    'After your yes, uploads the spec to ConPort and asks whether to plan and build it now'
  ],
  proposal: [
    'Takes the proposal into the project as an idea',
    'Talks it through with you: a small fix, a look around, or a spec',
    'After your yes, uploads the spec to ConPort and asks whether to plan and build it now'
  ],
  spec: [
    'Reads the spec and writes the plan with you',
    'After your yes, imports the plan: the epic and its tasks are In work',
    'Builds the epic right away in a working copy of its own'
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
  switch (sheet.kind) {
    case 'idea': {
      const stage = taskLine({ ...sheet.idea, kind: 'task' }).toLowerCase()
      return { title: `Brainstorm “${sheet.idea.title}”`, description: `${sheet.idea.id} · ${stage}`, who: 'Who brainstorms', button: 'Brainstorm' }
    }
    case 'proposal':
    case 'decline': {
      const { doc, title, author } = sheet.proposal
      const description = author ? `doc-${doc} · proposal · ${author}` : `doc-${doc} · proposal`
      return sheet.kind === 'proposal'
        ? { title: `Brainstorm “${title}”`, description, who: 'Who brainstorms', button: 'Brainstorm' }
        : { title: `Decline “${title}”`, description, who: 'Why it is declined', button: 'Decline' }
    }
    case 'spec': {
      const { doc, title, epic } = sheet.spec
      const description = epic === null || epic === undefined ? `doc-${doc} · no plan` : `epic ${epic} · doc-${doc} · no plan`
      return { title: `Plan & build “${title}”`, description, who: 'Who plans and builds', button: 'Plan & build' }
    }
    default: {
      const { button, who } = HAND_SHEETS[sheet.kind]
      const stage = taskLine({ ...sheet.task, kind: 'task' }).toLowerCase()
      return { title: `${button} “${sheet.task.title}”`, description: `${sheet.task.id} · ${stage}`, who, button }
    }
  }
}

/** Where the lead session of an epic was opened. */
export const startNotice = (/** @type {number} */ epic) => `The agent of epic ${epic} is open in the lead tab of space epic-${epic}; it asks its questions there`

/**
 * What a sheet did: where its agent was opened (`tab`, the task or idea `id`) and what comes of
 * it; a decline (`id` the proposal) opened none.
 * @param {{kind: SheetKind, id: number, tab: string | null, project: string}} sheet
 * @returns {string}
 */
export function handNotice({ kind, id, tab, project }) {
  if (kind === 'decline') return `Proposal doc-${id} is declined.`
  const where = `in tab ${tab} of project “${project}”`
  if (kind === 'idea') return `Idea ${id} is open ${where}: the agent is waiting for you there to talk it through.`
  if (kind === 'proposal') return `The proposal is idea ${id} now; it is open ${where}: the agent is waiting for you there to talk it through.`
  if (kind === 'spec') {
    return `Plan & build is open ${where}: the agent writes the plan with you there. Once the plan is in ConPort, its epic is In work.`
  }
  if (kind === 'fix') {
    return `Fixes of task ${id} are open ${where}: the agent is waiting for you there. Once it writes its fixes to the journal, the task waits for review again; press Refresh.`
  }
  if (kind === 'review') {
    return `Review of task ${id} is open ${where}: the agent writes its verdict to the task's journal and, on approval, closes the task with your consent.`
  }
  return `Task ${id} is open ${where}: the agent is waiting for you there. The work goes to a separate branch of the task, and you merge it. Once the agent writes its report, the task waits for review; press Refresh.`
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
