import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { sddSections } from '../mods/conport/cli.js'
import { DEFAULT_ROLES } from '../mods/conport/harness.js'
import {
  BUG_LABEL,
  COPY_NOTE,
  documentUrl,
  epicState,
  epicTaskRow,
  FIXER_NOTE,
  FULL_READ_MS,
  handNotice,
  harnessLabel,
  NO_AGENT,
  ORCA_NOTE,
  plural,
  POLL_TAKEN_MS,
  pollStep,
  QUESTIONS_NOTE,
  releaseLine,
  ROLE_KEYS,
  ROLE_TITLES,
  roleChoice,
  roleLists,
  ROLES_NO_HARNESS_NOTE,
  ROLES_UNTYPED_NOTE,
  rowActions,
  rowLine,
  rowTaken,
  SECTION_TITLES,
  SECTIONS,
  sectionLabel,
  sectionsOpen,
  SHEET_STEPS,
  sheetAgent,
  sheetText,
  skippedLine,
  startNotice,
  startView,
  TAKE_OVER_CONFIRM,
  takenMap,
  taskLine,
  TYPE_MISSING_NOTE,
  updatedLine
} from '../mods/conport/screen.js'
import { startHold } from '../mods/conport/session.js'
import { MOD_DIR } from './records.mjs'

/** A document as the CLI names it: `doc-<N>`, the number never written out. */
const docRef = (n) => `doc-${n}`

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

test('four sections in order with captions, Outside SDD folded by default', () => {
  assert.deepEqual(SECTIONS, [
    { key: 'in_work', title: 'In work', caption: 'spec + plan', open: true },
    { key: 'specs', title: 'Specs', caption: 'spec, no plan', open: true },
    { key: 'ideas', title: 'Ideas', caption: 'not worked through', open: true },
    { key: 'outside', title: 'Outside SDD', caption: 'no spec', open: false }
  ])
  assert.deepEqual(SECTION_TITLES, { in_work: 'In work', specs: 'Specs', ideas: 'Ideas', outside: 'Outside SDD' })
  assert.equal(sectionLabel('in_work', 3), 'In work · 3')
  assert.equal(sectionLabel('outside', 0), 'Outside SDD · 0')
  // Nothing kept: every section as the spec opens it, Outside SDD folded.
  assert.deepEqual(sectionsOpen(null), { in_work: true, specs: true, ideas: true, outside: false })
  assert.deepEqual(sectionsOpen('garbage'), { in_work: true, specs: true, ideas: true, outside: false })
  // What the person folded or opened is kept; a value that is no boolean, or a key no section has, is not taken.
  assert.deepEqual(sectionsOpen({ in_work: false, outside: true, ideas: 'yes', tabs: true }), {
    in_work: false,
    specs: true,
    ideas: true,
    outside: true
  })
})

test('the roles are named as the screen says them', () => {
  assert.deepEqual(ROLE_KEYS, Object.keys(DEFAULT_ROLES))
  assert.deepEqual(ROLE_TITLES, {
    implementer: 'Implementer',
    reviewer: 'Reviewer',
    gapHunter: 'Gap hunter',
    finalReviewer: 'Final reviewer'
  })
})

test('updatedLine today and on another day', () => {
  const now = new Date(2026, 10, 17, 18, 30)
  // The time of this machine, 24 hours, two digits each.
  assert.equal(updatedLine(new Date(2026, 10, 17, 9, 5).toISOString(), now), 'In progress · updated 09:05')
  assert.equal(updatedLine(new Date(2026, 10, 17, 0, 0).toISOString(), now), 'In progress · updated 00:00')
  // Yesterday, and another year: the day and the month in English.
  assert.equal(updatedLine(new Date(2026, 10, 16, 23, 59).toISOString(), now), 'In progress · updated 16 Nov 23:59')
  assert.equal(updatedLine(new Date(2025, 10, 17, 9, 5).toISOString(), now), 'In progress · updated 17 Nov 09:05')
  assert.equal(updatedLine(new Date(2026, 0, 3, 7, 0).toISOString(), now), 'In progress · updated 3 Jan 07:00')
  // No time, or one that is no date: in progress, no time said.
  assert.equal(updatedLine(undefined, now), 'In progress')
  assert.equal(updatedLine('not a date', now), 'In progress')
})

test('the light read and the full read: every minute, the full read every 10 minutes, never two at once', () => {
  assert.equal(POLL_TAKEN_MS, 60000)
  assert.equal(FULL_READ_MS, 600000)
  // A read is running: the tick starts nothing.
  assert.equal(pollStep({ reading: true, sinceFull: FULL_READ_MS * 2 }), 'none')
  assert.equal(pollStep({ reading: true, sinceFull: 0 }), 'none')
  // On the boundary of 10 minutes and past it: the full read; under it the light one.
  assert.equal(pollStep({ reading: false, sinceFull: FULL_READ_MS }), 'full')
  assert.equal(pollStep({ reading: false, sinceFull: FULL_READ_MS + 1 }), 'full')
  assert.equal(pollStep({ reading: false, sinceFull: FULL_READ_MS - 1 }), 'taken')
  assert.equal(pollStep({ reading: false, sinceFull: 0 }), 'taken')
})

/** A list of `conport sdd list --json` with one row of each kind. */
const SDD = () => ({
  project: 'prk7m2qx9d',
  in_work: [
    { id: 1803, title: 'Billing', status: 'TODO', progress: { open: 2, total: 3 }, milestone: null, ready: false, reason: null, spec: 245, idea: 2233 },
    { id: 1820, title: 'Search', status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', progress: { open: 1, total: 3 }, milestone: null, ready: false, reason: null, spec: null, idea: null }
  ],
  specs: [
    { doc: 245, title: 'Billing spec', idea: 2233, priority: 2, epic: null, status: null },
    { doc: 190, title: 'Graph spec', idea: null, priority: 3, epic: 1597, status: 'TODO' }
  ],
  ideas: [
    { id: 2116, kind: 'task', title: 'a', status: 'TODO', priority: 3, changes_requested: false },
    { id: 2117, kind: 'task', title: 'b', status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', priority: 3, changes_requested: false },
    { id: 2118, kind: 'task', title: 'c', status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', priority: 3, changes_requested: true }
  ],
  proposals: [{ doc: 301, title: 'Dark theme', author: 'Anna' }],
  outside: [{ id: 1916, title: 'Waiting', status: 'TODO', milestone: null, progress: { open: 1, total: 1 }, tasks: [] }]
})

const lightRead = (...ids) => ({ project: 'prk7m2qx9d', taken: ids.map((id) => ({ id, kind: 'task', updated_at: '2026-11-17T10:00:00Z' })) })

test('takenMap and rowTaken: the light read marks the rows by its own set, the list alone by its statuses', () => {
  const sections = sddSections(SDD())
  const [i2116, i2117, i2118] = sections.ideas
  // No light read yet: what the full list says.
  assert.equal(takenMap(null), null)
  assert.deepEqual([i2116, i2117, i2118].map((row) => rowTaken(row, null)), [false, true, false])
  // The light read: a row of the list with a number in its set is taken, one without is not.
  const map = takenMap(lightRead(2116, 2118))
  assert.deepEqual([...map.entries()], [
    [2116, '2026-11-17T10:00:00Z'],
    [2118, '2026-11-17T10:00:00Z']
  ])
  assert.deepEqual([i2116, i2117, i2118].map((row) => rowTaken(row, map)), [true, false, false])
  // An answer without a list of taken rows marks nothing.
  assert.deepEqual([...takenMap({ project: 'p' }).entries()], [])
})

test('row actions follow the table of the spec: Brainstorm, Show terminal or Take over, Blocked, Review or Fix, Plan & build and Open spec, Start, Hand to agent', () => {
  const idea = (status, mode, extra = {}) => ({ type: 'idea', status, mode, kind: 'task', priority: 3, changes_requested: mode === 'fix', ...extra })
  // An idea to do: Brainstorm; its tab open here: Show terminal.
  assert.deepEqual(rowActions(idea('TODO', 'do'), false, false), ['Brainstorm'])
  assert.deepEqual(rowActions(idea('TODO', 'do'), false, true), ['Show terminal'])
  // An idea in progress: Show terminal when this host opened its terminal, else Take over.
  assert.deepEqual(rowActions(idea('IN_PROGRESS', null), true, true), ['Show terminal'])
  assert.deepEqual(rowActions(idea('IN_PROGRESS', null), true, false), ['Take over'])
  // Blocked: no button, the line says it.
  assert.deepEqual(rowActions(idea('BLOCKED', null), false, false), [])
  assert.equal(rowLine(idea('BLOCKED', null), { taken: false }), 'Blocked')
  // In review, and back from review.
  assert.deepEqual(rowActions(idea('REVIEW', 'review'), false, false), ['Review'])
  assert.deepEqual(rowActions(idea('IN_PROGRESS', 'fix'), false, false), ['Fix'])
  // A proposal.
  assert.deepEqual(rowActions({ type: 'proposal', author: 'Anna' }, false, false), ['Brainstorm', 'Decline'])
  // A spec, a document or an epic: Plan & build and Open spec; Show terminal while its plan is
  // written from this host; Take over for an epic of a spec taken by another session.
  assert.deepEqual(rowActions({ type: 'spec', epic: null }, false, false), ['Plan & build', 'Open spec'])
  assert.deepEqual(rowActions({ type: 'spec', epic: null }, false, true), ['Show terminal', 'Open spec'])
  assert.deepEqual(rowActions({ type: 'spec', epic: 1597 }, true, false), ['Take over', 'Open spec'])
  assert.deepEqual(rowActions({ type: 'spec', epic: 1597 }, true, true), ['Show terminal', 'Open spec'])
  // An epic In work: Start; taken, Show terminal or Take over; one that cannot run, nothing.
  const epic = (extra = {}) => ({ type: 'epic', section: 'in_work', status: 'TODO', reason: null, ready: false, progress: { open: 1, total: 2 }, ...extra })
  assert.deepEqual(rowActions(epic(), false, false), ['Start'])
  assert.deepEqual(rowActions(epic({ status: 'IN_PROGRESS' }), true, false), ['Take over'])
  assert.deepEqual(rowActions(epic({ status: 'IN_PROGRESS' }), true, true), ['Show terminal'])
  assert.deepEqual(rowActions(epic({ reason: 'two specs' }), false, false), [])
  // An epic outside SDD has no button; its tasks are handed as the tab Tasks handed them.
  assert.deepEqual(rowActions(epic({ section: 'outside' }), false, false), [])
  assert.deepEqual(rowActions({ type: 'task', status: 'TODO', mode: 'do' }, false, false), ['Hand to agent'])
  assert.deepEqual(rowActions({ type: 'task', status: 'REVIEW', mode: 'review' }, false, false), ['Review'])
  assert.deepEqual(rowActions({ type: 'task', status: 'IN_PROGRESS', mode: 'fix' }, false, false), ['Fix'])
  assert.deepEqual(rowActions({ type: 'task', status: 'IN_PROGRESS', mode: null }, false, false), [])
})

test('an idea the list holds in review and the light read holds taken: its line and its buttons say the same', () => {
  const now = new Date(2026, 10, 17, 12, 0)
  const at = new Date(2026, 10, 17, 9, 30).toISOString()
  // The full list still says REVIEW (mode review); the light read says another session took it.
  const row = { type: 'idea', status: 'REVIEW', mode: 'review', kind: 'task', priority: 3, changes_requested: false }
  assert.equal(rowLine(row, { taken: true, updated: at, now }), 'In progress · updated 09:30')
  assert.deepEqual(rowActions(row, true, false), ['Take over'])
  assert.deepEqual(rowActions(row, true, true), ['Show terminal'])
  // Not taken: in review, Review — even while the tab of its brainstorm is still open here.
  assert.equal(rowLine(row, { taken: false }), 'In review')
  assert.deepEqual(rowActions(row, false, true), ['Review'])
  assert.deepEqual(rowActions(row, false, false), ['Review'])
  // Back from review it is never taken (rowTaken), so it shows Fix with its tab open too.
  const back = { ...row, status: 'IN_PROGRESS', mode: 'fix', changes_requested: true }
  assert.equal(rowLine(back, { taken: false }), 'Changes requested')
  assert.deepEqual(rowActions(back, false, true), ['Fix'])
})

test('an idea back from review shows Fix, not In progress', () => {
  const sections = sddSections(SDD())
  const back = sections.ideas.find((row) => row.id === 2118)
  // The light read lists it: it is in progress on the server, yet nobody is at it.
  const map = takenMap(lightRead(2117, 2118))
  const taken = rowTaken(back, map)
  assert.equal(taken, false)
  const row = { type: 'idea', ...back }
  assert.deepEqual(rowActions(row, taken, false), ['Fix'])
  assert.equal(rowLine(row, { taken, updated: map.get(2118), now: new Date(2026, 10, 17, 12, 0) }), 'Changes requested')
  // The idea a session is at, from the same light read: In progress with its time, Take over.
  const at = sections.ideas.find((r) => r.id === 2117)
  assert.equal(rowTaken(at, map), true)
  const now = new Date('2026-11-17T12:00:00Z')
  assert.equal(rowLine({ type: 'idea', ...at }, { taken: true, updated: map.get(2117), now }), updatedLine('2026-11-17T10:00:00Z', now))
  assert.deepEqual(rowActions({ type: 'idea', ...at }, true, false), ['Take over'])
})

test('rowLine: what each row says under its title', () => {
  const now = new Date(2026, 10, 17, 12, 0)
  const at = new Date(2026, 10, 17, 9, 30).toISOString()
  // An idea to do by its priority, a bug marked; one taken by its time.
  assert.equal(rowLine({ type: 'idea', kind: 'task', status: 'TODO', priority: 2, changes_requested: false }, { taken: false }), 'High · not started')
  assert.equal(rowLine({ type: 'idea', kind: 'bug', status: 'BLOCKED', priority: 2, changes_requested: false }, { taken: false }), `${BUG_LABEL} · Blocked`)
  assert.equal(rowLine({ type: 'idea', kind: 'bug', status: 'IN_PROGRESS', priority: 2, changes_requested: false }, { taken: true, updated: at, now }), `${BUG_LABEL} · In progress · updated 09:30`)
  // A proposal by its author.
  assert.equal(rowLine({ type: 'proposal', author: 'Anna' }, { taken: false }), 'Proposal · Anna')
  assert.equal(rowLine({ type: 'proposal', author: null }, { taken: false }), 'Proposal')
  // A spec document by the priority of its idea; the spec of an epic; one taken.
  assert.equal(rowLine({ type: 'spec', epic: null, priority: 3 }, { taken: false }), 'Medium · no plan')
  assert.equal(rowLine({ type: 'spec', epic: 1597, priority: 3 }, { taken: false }), 'Epic 1597 · no plan')
  assert.equal(rowLine({ type: 'spec', epic: 1597, priority: 3 }, { taken: true, updated: at, now }), 'In progress · updated 09:30')
  // An epic In work: ready to merge before anything; one that cannot run says why; taken by its time.
  const epic = (extra = {}) => ({ type: 'epic', section: 'in_work', status: 'TODO', reason: null, ready: false, progress: { open: 1, total: 3 }, ...extra })
  assert.equal(rowLine(epic({ ready: true, progress: { open: 0, total: 3 } }), { taken: true, updated: at, now }), 'Ready to merge · 3 of 3 closed')
  assert.equal(rowLine(epic({ reason: 'two specs' }), { taken: false }), 'Cannot start: two specs')
  assert.equal(rowLine(epic(), { taken: true, updated: at, now }), 'In progress · updated 09:30')
  assert.equal(rowLine(epic(), { taken: false }), 'In progress · 2 of 3 closed')
  // An epic outside SDD by its closed tasks.
  assert.equal(rowLine(epic({ section: 'outside' }), { taken: false }), '2 of 3 closed')
  assert.equal(rowLine(epic({ section: 'outside' }), { taken: true, updated: at, now }), 'In progress · updated 09:30')
})

test('TAKE_OVER_CONFIRM and skippedLine are the words of the spec', () => {
  assert.equal(TAKE_OVER_CONFIRM, 'Another session may be working on it')
  assert.equal(skippedLine(1), '1 proposal is not shown: its state line cannot be read')
  assert.equal(skippedLine(3), '3 proposals are not shown: their state lines cannot be read')
})

test('documentUrl: the document in the dashboard, in the team of the project', () => {
  assert.equal(
    documentUrl({ canonical: 'pers/conport-global', handle: 'pr3dngdqr5', doc: 245 }),
    'https://me.conport.app/t/pers/p/pr3dngdqr5/documents?id=245'
  )
  assert.equal(
    documentUrl({ canonical: 'k7m2qx9d/api', handle: 'prk7m2qx9d', doc: 7 }),
    'https://me.conport.app/t/k7m2qx9d/p/prk7m2qx9d/documents?id=7'
  )
  // An address with no team in it names no page.
  assert.equal(documentUrl({ canonical: 'api', handle: 'prk7m2qx9d', doc: 7 }), null)
  assert.equal(documentUrl({ canonical: null, handle: 'prk7m2qx9d', doc: 7 }), null)
})

test('no Prepare or Write plan anywhere', () => {
  const files = readdirSync(MOD_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(MOD_DIR, name))
  files.push(join(MOD_DIR, '..', '..', 'RECIPE.md'), join(MOD_DIR, '..', '..', 'README.md'))
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => assert.doesNotMatch(line, /\bPrepare\b|Write plan|prompt prepare|Ready to run/, `${file}:${i + 1}`))
  }
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

test('sheetText and SHEET_STEPS: what the sheet of an idea, a proposal, a spec, a decline or a task says', () => {
  const idea = { id: 2116, kind: 'task', title: 'Dark theme', status: 'TODO', priority: 2, changes_requested: false }
  assert.deepEqual(sheetText({ kind: 'idea', idea }), {
    title: 'Brainstorm “Dark theme”',
    description: '2116 · high · not started',
    who: 'Who brainstorms',
    button: 'Brainstorm'
  })
  const proposal = { doc: 301, title: 'Offline mode', author: 'Anna' }
  assert.deepEqual(sheetText({ kind: 'proposal', proposal }), {
    title: 'Brainstorm “Offline mode”',
    description: `${docRef(301)} · proposal · Anna`,
    who: 'Who brainstorms',
    button: 'Brainstorm'
  })
  assert.deepEqual(sheetText({ kind: 'decline', proposal: { ...proposal, author: null } }), {
    title: 'Decline “Offline mode”',
    description: `${docRef(301)} · proposal`,
    who: 'Why it is declined',
    button: 'Decline'
  })
  const spec = { doc: 245, title: 'Billing spec', idea: 2233, priority: 3, epic: null, status: null }
  assert.deepEqual(sheetText({ kind: 'spec', spec }), {
    title: 'Plan & build “Billing spec”',
    description: `${docRef(245)} · no plan`,
    who: 'Who plans and builds',
    button: 'Plan & build'
  })
  assert.equal(sheetText({ kind: 'spec', spec: { ...spec, doc: 190, epic: 1597 } }).description, `epic 1597 · ${docRef(190)} · no plan`)
  const task = { id: 31, title: 'Login', status: 'REVIEW', kind: 'task' }
  assert.deepEqual(sheetText({ kind: 'review', task }), { title: 'Review “Login”', description: '31 · in review', who: 'Who reviews', button: 'Review' })
  assert.equal(sheetText({ kind: 'fix', task: { ...task, status: 'IN_PROGRESS', changes_requested: true } }).who, 'Who fixes')
  assert.equal(sheetText({ kind: 'do', task: { ...task, status: 'TODO', priority: 3 } }).button, 'Hand to agent')
  // A decline opens no agent: it has no steps.
  assert.deepEqual(Object.keys(SHEET_STEPS).sort(), ['do', 'fix', 'idea', 'proposal', 'review', 'spec'])
  for (const kind of Object.keys(SHEET_STEPS)) assert.equal(SHEET_STEPS[kind].length, 3, kind)
})

test('startNotice and handNotice: where the agent was opened', () => {
  assert.equal(startNotice(412), 'The agent of epic 412 is open in the lead tab of space epic-412; it asks its questions there')
  assert.match(handNotice({ kind: 'idea', id: 2116, tab: 'idea-2116', project: 'acme-app' }), /^Idea 2116 is open in tab idea-2116 of project “acme-app”/)
  assert.match(handNotice({ kind: 'proposal', id: 2301, tab: 'idea-2301', project: 'acme-app' }), /^The proposal is idea 2301 now; it is open in tab idea-2301 of project “acme-app”/)
  assert.ok(handNotice({ kind: 'spec', id: 245, tab: docRef(245), project: 'acme-app' }).startsWith(`Plan & build is open in tab ${docRef(245)} of project “acme-app”`))
  assert.equal(handNotice({ kind: 'decline', id: 301, tab: null, project: 'acme-app' }), `Proposal ${docRef(301)} is declined.`)
  assert.match(handNotice({ kind: 'do', id: 31, tab: 'task-31', project: 'acme-app' }), /^Task 31 is open in tab task-31 of project “acme-app”/)
  assert.match(handNotice({ kind: 'review', id: 31, tab: 'task-31', project: 'acme-app' }), /^Review of task 31 is open in tab task-31/)
  assert.match(handNotice({ kind: 'fix', id: 31, tab: 'task-31', project: 'acme-app' }), /^Fixes of task 31 are open in tab task-31/)
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
