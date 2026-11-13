import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ROLES } from '../mods/conport/harness.js'
import {
  BUG_LABEL,
  COPY_NOTE,
  epicState,
  epicTaskRow,
  FIXER_NOTE,
  handNotice,
  harnessLabel,
  NO_AGENT,
  ORCA_NOTE,
  plural,
  PREPARE_STATE,
  QUESTIONS_NOTE,
  releaseLine,
  ROLE_KEYS,
  ROLE_TITLES,
  roleChoice,
  roleLists,
  ROLES_NO_HARNESS_NOTE,
  ROLES_UNTYPED_NOTE,
  SHEET_STEPS,
  sheetAgent,
  sheetText,
  startNotice,
  startView,
  TAB_TITLES,
  tabLabel,
  TASK_GROUPS,
  taskLine,
  TYPE_MISSING_NOTE
} from '../mods/conport/screen.js'
import { startHold } from '../mods/conport/session.js'

test('plural: the English word for a count, singular for exactly one', () => {
  assert.equal(plural(1, 'task', 'tasks'), 'task')
  assert.equal(plural(0, 'task', 'tasks'), 'tasks')
  assert.equal(plural(2, 'task', 'tasks'), 'tasks')
  // 21 and 101 end in one but take the plural in English.
  assert.equal(plural(21, 'task', 'tasks'), 'tasks')
  assert.equal(plural(101, 'task', 'tasks'), 'tasks')
})

test('releaseLine: a release milestone ready to close, or how many epics it holds open', () => {
  assert.equal(releaseLine({ ready_to_close: true, open_epics: 0 }), 'Release · ready to close')
  assert.equal(releaseLine({ ready_to_close: false, open_epics: 1 }), 'Release · 1 epic open')
  assert.equal(releaseLine({ ready_to_close: false, open_epics: 3 }), 'Release · 3 epics open')
  assert.equal(releaseLine({ ready_to_close: false }), 'Release · 0 epics open')
})

test('epicState: ready to merge by the field ready, in progress, or not started', () => {
  assert.equal(epicState({ ready: true, status: 'IN_PROGRESS', progress: { open: 0, total: 4 } }), 'Ready to merge · 4 of 4 closed')
  assert.equal(epicState({ ready: false, status: 'IN_PROGRESS', progress: { open: 3, total: 4 } }), 'In progress · 1 of 4 closed')
  // A closed task makes the epic started even when its status says it is not.
  assert.equal(epicState({ ready: false, status: 'TODO', progress: { open: 1, total: 2 } }), 'In progress · 1 of 2 closed')
  assert.equal(epicState({ ready: false, status: 'TODO', progress: { open: 2, total: 2 } }), 'Not started · 2 tasks')
  assert.equal(epicState({ ready: false, status: 'TODO', progress: { open: 1, total: 1 } }), 'Not started · 1 task')
  assert.equal(epicState({ ready: false, status: 'TODO' }), 'Not started · 0 tasks')
})

test('the tabs, the groups of tasks and the roles are named as the screens say them', () => {
  assert.deepEqual(TAB_TITLES, { launch: 'Ready to run', prepare: 'Prepare', tasks: 'Tasks' })
  assert.equal(tabLabel('launch', 3), 'Ready to run · 3')
  assert.equal(tabLabel('tasks', 0), 'Tasks · 0')
  assert.deepEqual(TASK_GROUPS, [
    ['review', 'In review'],
    ['inProgress', 'In progress'],
    ['todo', 'To do']
  ])
  assert.deepEqual(ROLE_KEYS, Object.keys(DEFAULT_ROLES))
  assert.deepEqual(ROLE_TITLES, {
    implementer: 'Implementer',
    reviewer: 'Reviewer',
    gapHunter: 'Gap hunter',
    finalReviewer: 'Final reviewer'
  })
  assert.deepEqual(PREPARE_STATE, { spec: 'No spec', plan: 'Spec, no plan', other: 'Not ready to run for another reason' })
})

test('the lines of the epic screen are the words of the spec', () => {
  assert.equal(FIXER_NOTE, 'Fixes: the same implementer, otherwise conport:sdd-fixer')
  assert.equal(TYPE_MISSING_NOTE, 'Type not found — install or update the conport plugin.')
  assert.equal(ROLES_NO_HARNESS_NOTE, 'Harness not found: its subagent types cannot be read')
  assert.equal(COPY_NOTE, 'The working copy is already there: the agent resumes where the work stopped')
  assert.equal(ORCA_NOTE, 'If a session in Orca runs this epic, do not start a second one')
  assert.equal(QUESTIONS_NOTE, 'The lead session asks its questions in its own terminal; Herdr calls you')
  assert.match(ROLES_UNTYPED_NOTE, /the roles follow the texts of conport agent <role>$/)
})

test('taskLine: a task outside the epics by its stage, a bug marked', () => {
  assert.equal(taskLine({ status: 'REVIEW', kind: 'task' }), 'In review')
  assert.equal(taskLine({ status: 'IN_PROGRESS', changes_requested: true, kind: 'task' }), 'Changes requested')
  assert.equal(taskLine({ status: 'IN_PROGRESS', changes_requested: false, kind: 'task' }), 'In progress')
  assert.equal(taskLine({ status: 'TODO', priority: 2, kind: 'task' }), 'High · not started')
  assert.equal(taskLine({ status: 'TODO', priority: 1, kind: 'task' }), 'Critical · not started')
  assert.equal(taskLine({ status: 'TODO', priority: 9, kind: 'bug' }), `${BUG_LABEL} · No priority · not started`)
})

test('epicTaskRow: the title first, the number and status under it, a mark in the theme state color of the status', () => {
  const row = (status) => epicTaskRow({ id: 5, title: 'Store a card token', status })
  // The mark is the name of the theme's state color main.js draws it in (theme().done, .working, .blocked, .idle).
  assert.deepEqual(row('TODO'), { title: 'Store a card token', line: '#5 · to do', mark: 'idle', muted: false })
  assert.deepEqual(row('IN_PROGRESS'), { title: 'Store a card token', line: '#5 · in progress', mark: 'working', muted: false })
  assert.deepEqual(row('REVIEW'), { title: 'Store a card token', line: '#5 · in review', mark: 'working', muted: false })
  assert.deepEqual(row('BLOCKED'), { title: 'Store a card token', line: '#5 · blocked', mark: 'blocked', muted: false })
  assert.deepEqual(row('DONE'), { title: 'Store a card token', line: '#5 · done', mark: 'done', muted: false })
  assert.deepEqual(row('PARKED'), { title: 'Store a card token', line: '#5 · parked', mark: 'idle', muted: false })
  // A cancelled task is no part of the epic's work: dimmed.
  assert.deepEqual(row('CANCELLED'), { title: 'Store a card token', line: '#5 · cancelled', mark: 'idle', muted: true })
  // A status the mod does not know is shown as the server names it.
  assert.deepEqual(row('SNOOZED'), { title: 'Store a card token', line: '#5 · SNOOZED', mark: 'idle', muted: false })
})

const choices = [
  { kind: 'claude', label: 'Claude Code', installed: true, run: ['claude'] },
  { kind: 'codex', label: 'Codex', installed: true, run: ['codex', '--no-daemon'] },
  { kind: 'cursor', label: 'Cursor', installed: false, run: null }
]

test('NO_AGENT: what is wrong and one action when no agent that takes a task is found', () => {
  assert.equal(
    NO_AGENT,
    'Only Claude Code, Codex and Cursor take a task, and none of them was found — install one of them and press Refresh.'
  )
})

test('harnessLabel: a harness that is not installed says so', () => {
  assert.equal(harnessLabel(choices[0]), 'Claude Code')
  assert.equal(harnessLabel(choices[2]), 'Cursor — not found')
})

const typed = { ok: true, data: { harness: 'claude', typed: true, subagents: [{ type: 'conport:sdd-implementer' }, { type: 'mine:reviewer' }] } }

test('roleLists: a harness that is not installed reads no types, its roles are the defaults', () => {
  const lists = roleLists({ installed: false, answer: typed, roles: { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' } })
  assert.deepEqual(lists, { on: false, note: ROLES_NO_HARNESS_NOTE, roles: DEFAULT_ROLES })
})

test('roleLists: null while the types of the harness are read', () => {
  assert.equal(roleLists({ installed: true, answer: undefined, roles: DEFAULT_ROLES }), null)
})

test('roleLists: a list that cannot be read is off with the refusal and its action', () => {
  const answer = { ok: false, error: { code: 'subagents_unavailable', fact: 'claude plugin list failed', action: 'install Claude Code' } }
  const lists = roleLists({ installed: true, answer, roles: { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' } })
  assert.equal(lists.on, false)
  assert.deepEqual(lists.roles, DEFAULT_ROLES)
  assert.equal(lists.note, 'The subagent list is unavailable, so the roles keep their default types: claude plugin list failed — install Claude Code')
})

test('roleLists: a harness without typed subagents goes by the texts of conport agent', () => {
  const lists = roleLists({ installed: true, answer: { ok: true, data: { harness: 'codex', typed: false, subagents: [] } }, roles: DEFAULT_ROLES })
  assert.deepEqual(lists, { on: false, note: ROLES_UNTYPED_NOTE, roles: DEFAULT_ROLES })
})

test('roleLists and roleChoice: typed subagents are the options, a type the list lacks stays marked', () => {
  const lists = roleLists({ installed: true, answer: typed, roles: { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' } })
  assert.deepEqual(lists, { on: true, types: ['conport:sdd-implementer', 'mine:reviewer'], roles: { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' } })
  assert.deepEqual(roleChoice(lists, 'implementer'), { value: 'conport:sdd-implementer', types: lists.types, missing: false })
  // The default gap hunter is not installed: it keeps its place, first in its list, marked.
  assert.deepEqual(roleChoice(lists, 'gapHunter'), {
    value: 'conport:sdd-gap-hunter',
    types: ['conport:sdd-gap-hunter', ...lists.types],
    missing: true
  })
  // A list that is off offers only the value it sends, never marked missing.
  assert.deepEqual(roleChoice({ on: false, note: 'x', roles: DEFAULT_ROLES }, 'reviewer'), {
    value: 'conport:sdd-task-reviewer',
    types: ['conport:sdd-task-reviewer'],
    missing: false
  })
})

test('sheetAgent: the agent of last time while it is installed, else the first installed one', () => {
  assert.equal(sheetAgent(choices, 'codex'), 'codex')
  assert.equal(sheetAgent(choices, 'cursor'), 'claude')
  assert.equal(sheetAgent(choices, null), 'claude')
  assert.equal(sheetAgent(choices.map((c) => ({ ...c, installed: false, run: null })), 'codex'), null)
})

test('sheetText and SHEET_STEPS: what the sheet of a preparation or a task says', () => {
  const epic = { id: 9, title: 'Billing' }
  assert.deepEqual(sheetText({ kind: 'spec', epic }), { title: 'Prepare “Billing”', description: '9 · no spec', who: 'Who prepares', button: 'Prepare' })
  assert.deepEqual(sheetText({ kind: 'plan', epic }), { title: 'Write plan “Billing”', description: '9 · no plan', who: 'Who prepares', button: 'Write plan' })
  const task = { id: 31, title: 'Login', status: 'REVIEW', kind: 'task' }
  assert.deepEqual(sheetText({ kind: 'review', task }), { title: 'Review “Login”', description: '31 · in review', who: 'Who reviews', button: 'Review' })
  assert.equal(sheetText({ kind: 'fix', task: { ...task, status: 'IN_PROGRESS', changes_requested: true } }).who, 'Who fixes')
  assert.equal(sheetText({ kind: 'do', task: { ...task, status: 'TODO', priority: 3 } }).button, 'Hand to agent')
  for (const kind of ['spec', 'plan', 'do', 'review', 'fix']) assert.equal(SHEET_STEPS[kind].length, 3, kind)
})

test('startNotice and handNotice: where the agent was opened', () => {
  assert.equal(startNotice(412), 'The agent of epic 412 is open in the lead tab of space epic-412; it asks its questions there')
  assert.match(handNotice({ kind: 'spec', id: 9, project: 'acme-app' }), /^Preparation of epic 9 is open in tab prepare-9 of project “acme-app”/)
  assert.match(handNotice({ kind: 'do', id: 31, project: 'acme-app' }), /^Task 31 is open in tab task-31 of project “acme-app”/)
  assert.match(handNotice({ kind: 'review', id: 31, project: 'acme-app' }), /^Review of task 31 is open in tab task-31/)
  assert.match(handNotice({ kind: 'fix', id: 31, project: 'acme-app' }), /^Fixes of task 31 are open in tab task-31/)
})

const existing = { ok: true, data: { root: '/r', base: 'main', worktree: '/w', copy: 'existing' } }
const fresh = { ok: true, data: { root: '/r', base: 'main', worktree: '/w', copy: 'new' } }

test('startView: no session and no copy — Start with the line about questions only', () => {
  assert.deepEqual(startView({ session: { live: false }, hold: null, place: fresh, ready: true }), {
    live: false,
    disabled: false,
    lines: [QUESTIONS_NOTE]
  })
})

test('startView: no session in a copy that is there — the copy note and the warning about Orca', () => {
  assert.deepEqual(startView({ session: { live: false }, hold: null, place: existing, ready: true }), {
    live: false,
    disabled: false,
    lines: [COPY_NOTE, ORCA_NOTE, QUESTIONS_NOTE]
  })
})

test('startView: right after a start the button is off with its line, the copy note left out', () => {
  const view = startView({ session: { live: false }, hold: startHold(412), place: existing, ready: true })
  assert.deepEqual(view, { live: false, disabled: true, lines: ['The agent is opening in space epic-412', ORCA_NOTE, QUESTIONS_NOTE] })
  const missed = startView({ session: { live: false }, hold: { epic: 412, missed: true }, place: existing, ready: true })
  assert.deepEqual(missed.lines[0], 'The agent did not appear — look at the lead tab of space epic-412.')
  assert.equal(missed.disabled, false)
})

test('startView: a live session shows its space and a start again; the hold no longer counts', () => {
  assert.deepEqual(startView({ session: { live: true, space: 's1' }, hold: startHold(412), place: existing, ready: true }), {
    live: true,
    disabled: false,
    lines: [ORCA_NOTE, QUESTIONS_NOTE]
  })
})

test('startView: nothing to start with — the button is off', () => {
  assert.equal(startView({ session: { live: false }, hold: null, place: fresh, ready: false }).disabled, true)
  assert.equal(startView({ session: { live: true, space: 's' }, hold: null, place: existing, ready: false }).disabled, true)
})
