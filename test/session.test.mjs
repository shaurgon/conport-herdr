import assert from 'node:assert/strict'
import test from 'node:test'
import {
  endSeenHolds,
  epicSession,
  HOLD_MS,
  holdState,
  launchSpace,
  localSpaces,
  releaseHold,
  rootSpace,
  rowSession,
  showTerminalCommands,
  startHold
} from '../mods/conport/session.js'
import { HOME, record } from './records.mjs'

/** A document as the CLI names it: `doc-<N>`, the number never written out. */
const docRef = (n) => `doc-${n}`

const W = (epic) => `${HOME}/.herdr/worktrees/acme-app/epic-${epic}`
const EPIC_412_SPACE = 'spedbe3f924f2f331e70b470d09ac8ba38'
const EPIC_413_SPACE = 'sp92a4e1f7d7ebb78013ee5451d64aabbf'
const EPIC_416_SPACE = 'sp25864106b0fa993855ef16228e111c69'
const EPIC_417_SPACE = 'sp5fa94f3b9b98eb6f3dd782688e31b4b7'

const session = (name, worktree) => {
  const { agents, panes, spaces } = record(name)
  return epicSession({ agents, panes, spaces, worktree })
}

test('an agent of agents() whose pane stands in the copy is the session', () => {
  assert.deepEqual(session('claude-working.json', W(412)), { live: true, space: EPIC_412_SPACE })
  assert.deepEqual(session('claude-blocked.json', W(412)), { live: true, space: EPIC_412_SPACE })
  assert.deepEqual(session('claude-idle.json', W(412)), { live: true, space: EPIC_412_SPACE })
  assert.deepEqual(session('codex-working.json', W(413)), { live: true, space: EPIC_413_SPACE })
  assert.deepEqual(session('codex-blocked.json', W(413)), { live: true, space: EPIC_413_SPACE })
  assert.deepEqual(session('codex-done.json', W(413)), { live: true, space: EPIC_413_SPACE })
})

test('Claude Code on the trust question is the session: a harness pane not yet in agents()', () => {
  const snap = record('claude-trust-prompt.json')
  // The record is what the rule is about: the pane is a harness and is not in agents().
  assert.ok(!snap.agents.some((agent) => agent.pane === 'p455c2725d4877e4e6820ff75feb7b24b'))
  assert.deepEqual(session('claude-trust-prompt.json', W(412)), { live: true, space: EPIC_412_SPACE })
})

test('a pane where the agent quit by itself is no session: its program is now the shell', () => {
  assert.deepEqual(session('claude-exited.json', W(416)), { live: false, space: null })
  assert.deepEqual(session('codex-exited.json', W(416)), { live: false, space: null })
  assert.deepEqual(session('codex-exited.json', W(417)), { live: false, space: null })
})

test('a pane not in agents() running a program that is no harness is no session', () => {
  const snap = record('claude-trust-prompt.json')
  const panes = snap.panes.map((pane) =>
    pane.cwd === W(412) ? { ...pane, program: { ...pane.program, key: 'nvim', name: 'Neovim' } } : pane
  )
  assert.deepEqual(epicSession({ ...snap, panes, worktree: W(412) }), { live: false, space: null })
})

test('a mod pane in the tab of the copy is no session: it has no terminal and no folder', () => {
  const snap = record('claude-exited.json')
  // The shape herdr.d.ts gives a mod pane: terminal null, `mod` set, no cwd and no program.
  const tab = snap.spaces.find((space) => space.id === EPIC_416_SPACE).tabs[0].id
  const panes = [...snap.panes, { pane: 'pmod', terminal: null, mod: 'files', tab, title: 'files', focused: false, zoomed: false }]
  assert.deepEqual(epicSession({ ...snap, panes, worktree: W(416) }), { live: false, space: null })
})

test('the session is found whatever the space is named', () => {
  const snap = record('claude-working.json')
  const spaces = snap.spaces.map((space) => (space.id === EPIC_412_SPACE ? { ...space, name: 'my work', named: true } : space))
  assert.deepEqual(epicSession({ ...snap, spaces, worktree: W(412) }), { live: true, space: EPIC_412_SPACE })

  const trust = record('claude-trust-prompt.json')
  const renamed = trust.spaces.map((space) => (space.id === EPIC_412_SPACE ? { ...space, name: 'other' } : space))
  assert.deepEqual(epicSession({ ...trust, spaces: renamed, worktree: W(412) }), { live: true, space: EPIC_412_SPACE })
})

test('a pane inside the copy counts, a pane in a folder that only starts like it does not', () => {
  const snap = record('claude-working.json')
  const moved = (cwd) => snap.panes.map((pane) => (pane.cwd === W(412) ? { ...pane, cwd } : pane))
  assert.equal(epicSession({ ...snap, panes: moved(`${W(412)}/backend/src`), worktree: W(412) }).live, true)
  assert.equal(epicSession({ ...snap, panes: moved(`${W(412)}0`), worktree: W(412) }).live, false)
  assert.equal(epicSession({ ...snap, panes: moved(`${HOME}/.herdr/worktrees/acme-app`), worktree: W(412) }).live, false)
  // The copy named with a trailing slash is the same copy.
  assert.equal(epicSession({ ...snap, worktree: `${W(412)}/` }).live, true)
})

test('a session in another copy is not the session of this epic', () => {
  assert.deepEqual(session('claude-working.json', W(413)), { live: false, space: null })
})

test('a space on another machine is not this machine: its panes are no session', () => {
  const snap = record('claude-working.json')
  const spaces = snap.spaces.map((space) => (space.id === EPIC_412_SPACE ? { ...space, machine: 'vps' } : space))
  assert.deepEqual(epicSession({ ...snap, spaces, worktree: W(412) }), { live: false, space: null })
  assert.deepEqual(localSpaces(spaces).map((space) => space.name), ['notes'])
})

test('launchSpace: the space of the live session, for a start again', () => {
  const snap = record('claude-working.json')
  const live = epicSession({ ...snap, worktree: W(412) })
  assert.equal(launchSpace({ session: live, spaces: snap.spaces, panes: snap.panes, worktree: W(412), epic: 412 }), EPIC_412_SPACE)
})

test('launchSpace: the space of a pane the agent quit, so the new lead tab opens there', () => {
  for (const [name, epic, space] of [
    ['claude-exited.json', 416, EPIC_416_SPACE],
    ['codex-exited.json', 417, EPIC_417_SPACE]
  ]) {
    const snap = record(name)
    const none = epicSession({ ...snap, worktree: W(epic) })
    assert.equal(none.live, false)
    assert.equal(launchSpace({ session: none, spaces: snap.spaces, panes: snap.panes, worktree: W(epic), epic }), space)
    // By the pane, not by the name of its space.
    const renamed = snap.spaces.map((s) => (s.id === space ? { ...s, name: 'renamed', folder: HOME } : s))
    assert.equal(launchSpace({ session: none, spaces: renamed, panes: snap.panes, worktree: W(epic), epic }), space)
  }
})

test('launchSpace: a space epic-<N> with its folder in the copy and no pane there', () => {
  const snap = record('claude-exited.json')
  const panes = snap.panes.filter((pane) => pane.cwd !== W(416))
  const none = { live: false, space: null }
  assert.equal(launchSpace({ session: none, spaces: snap.spaces, panes, worktree: W(416), epic: 416 }), EPIC_416_SPACE)
  // Named otherwise, a space with no pane in the copy is not taken.
  const spaces = snap.spaces.map((space) => (space.id === EPIC_416_SPACE ? { ...space, name: 'misc' } : space))
  assert.equal(launchSpace({ session: none, spaces, panes, worktree: W(416), epic: 416 }), null)
})

test('launchSpace: nothing of the epic is open, so a new space is made', () => {
  const snap = record('claude-working.json')
  assert.equal(launchSpace({ session: { live: false, space: null }, spaces: snap.spaces, panes: snap.panes, worktree: W(500), epic: 500 }), null)
})

test('the start button waits after a start, with the line saying where the agent opens', () => {
  const hold = startHold(412)
  assert.deepEqual(holdState(hold, { live: false, space: null }), {
    disabled: true,
    line: 'The agent is opening in space epic-412'
  })
})

test('the wait ends when the session appears', () => {
  const snap = record('claude-trust-prompt.json')
  const hold = startHold(412)
  assert.deepEqual(holdState(hold, epicSession({ ...snap, worktree: W(412) })), { disabled: false, line: null })
  assert.equal(releaseHold(hold, 'session'), null)
})

test('a session seen ends the wait: it quitting before the timer leaves Start on', () => {
  const key = `${HOME}/src/acme-app/.git:412`
  let cancelled = 0
  const holds = { [key]: { hold: startHold(412), task: { cancel: () => cancelled++ }, worktree: W(412) } }
  const none = { live: false, space: null }
  const nothing = () => none
  // Right after the start no session is there: the wait goes on, the button is off.
  endSeenHolds(holds, nothing)
  assert.deepEqual(holdState(holds[key]?.hold ?? null, none), { disabled: true, line: 'The agent is opening in space epic-412' })
  // The session appears: the wait ends at once and its timer with it.
  const snap = record('claude-trust-prompt.json')
  endSeenHolds(holds, (worktree) => epicSession({ ...snap, worktree }))
  assert.equal(key in holds, false)
  assert.equal(cancelled, 1)
  // The agent quits before the 60 s are up: Start is on, no line that it is opening.
  const exited = record('claude-exited.json')
  assert.equal(epicSession({ ...exited, worktree: W(412) }).live, false)
  assert.deepEqual(holdState(holds[key]?.hold ?? null, none), { disabled: false, line: null })
})

test('a session seen after the timer ends the missed wait too: the entry goes, the button is on', () => {
  const key = `${HOME}/src/acme-app/.git:412`
  const missed = releaseHold(startHold(412), 'timer')
  const holds = { [key]: { hold: missed, task: null, worktree: W(412) } }
  const none = { live: false, space: null }
  assert.deepEqual(holdState(holds[key].hold, none), {
    disabled: false,
    line: 'The agent did not appear — look at the lead tab of space epic-412.'
  })
  const snap = record('claude-working.json')
  endSeenHolds(holds, (worktree) => epicSession({ ...snap, worktree }))
  assert.equal(key in holds, false)
  // The session quits later: no line that the agent was not seen comes back.
  assert.deepEqual(holdState(holds[key]?.hold ?? null, none), { disabled: false, line: null })
})

test('a session seen ends only the wait of its own copy', () => {
  const snap = record('claude-working.json')
  const holds = {
    a: { hold: startHold(412), task: null, worktree: W(412) },
    b: { hold: startHold(413), task: null, worktree: W(413) }
  }
  endSeenHolds(holds, (worktree) => epicSession({ ...snap, worktree }))
  assert.deepEqual(Object.keys(holds), ['b'])
  assert.deepEqual(holds.b.hold, startHold(413))
})

test('the wait ends on Refresh without a line', () => {
  const hold = releaseHold(startHold(412), 'refresh')
  assert.deepEqual(holdState(hold, { live: false, space: null }), { disabled: false, line: null })
})

test('the wait ends on the one-off timer of 60 s, with the line to look at the lead tab', () => {
  assert.equal(HOLD_MS, 60000)
  const hold = releaseHold(startHold(412), 'timer')
  assert.deepEqual(holdState(hold, { live: false, space: null }), {
    disabled: false,
    line: 'The agent did not appear — look at the lead tab of space epic-412.'
  })
  // Once the session is there, the line is gone too.
  assert.deepEqual(holdState(hold, { live: true, space: 'x' }), { disabled: false, line: null })
})

test('no start, no wait', () => {
  assert.deepEqual(holdState(null, { live: false, space: null }), { disabled: false, line: null })
})

test('rootSpace: the space of this machine with a pane in the main checkout or inside it', () => {
  const snap = record('claude-working.json')
  const ROOT = `${HOME}/src/acme-app`
  // The record has no pane in the root: none is the space of the project.
  assert.equal(rootSpace({ ...snap, root: ROOT }), null)
  const panes = snap.panes.map((pane) => (pane.cwd === `${HOME}/notes` ? { ...pane, cwd: `${ROOT}/backend` } : pane))
  assert.equal(rootSpace({ spaces: snap.spaces, panes, root: ROOT }), 'sp181d9986e6b719db33e8a6e91303098d')
  assert.equal(rootSpace({ spaces: snap.spaces, panes, root: `${ROOT}/` }), 'sp181d9986e6b719db33e8a6e91303098d')
  // A folder that only starts like the root is not in it.
  const beside = snap.panes.map((pane) => (pane.cwd === `${HOME}/notes` ? { ...pane, cwd: `${ROOT}-old` } : pane))
  assert.equal(rootSpace({ spaces: snap.spaces, panes: beside, root: ROOT }), null)
  // A space of another machine is never the space of the project.
  const remote = snap.spaces.map((space) => ({ ...space, machine: 'vps' }))
  assert.equal(rootSpace({ spaces: remote, panes, root: ROOT }), null)
})

test('rootSpace: a pane in another copy of the repository nested in the root is not in the main checkout', () => {
  const snap = record('claude-working.json')
  const ROOT = `${HOME}/src/acme-app`
  const NESTED = `${ROOT}/.claude/worktrees/side`
  const worktrees = [ROOT, NESTED, `${HOME}/.herdr/worktrees/acme-app/epic-412`]
  const nestedPane = (pane) => (pane.cwd === `${HOME}/.herdr/worktrees/acme-app/epic-412` ? { ...pane, cwd: `${NESTED}/backend` } : pane)
  // The pane of the nested copy is listed first, the pane of the root after it.
  const both = snap.panes.map(nestedPane).map((pane) => (pane.cwd === `${HOME}/notes` ? { ...pane, cwd: ROOT } : pane)).reverse()
  assert.equal(both[0].cwd, `${NESTED}/backend`)
  assert.equal(rootSpace({ spaces: snap.spaces, panes: both, root: ROOT, worktrees }), 'sp181d9986e6b719db33e8a6e91303098d')
  // Only the nested copy has a pane: there is no space of the project.
  const only = snap.panes.map(nestedPane)
  assert.equal(rootSpace({ spaces: snap.spaces, panes: only, root: ROOT, worktrees }), null)
  // The root itself in the list of copies excludes nothing.
  assert.equal(rootSpace({ spaces: snap.spaces, panes: both, root: `${ROOT}/`, worktrees: [`${ROOT}/`] }), 'spedbe3f924f2f331e70b470d09ac8ba38')
})

const NOTES_SPACE = 'sp181d9986e6b719db33e8a6e91303098d'

/** The snapshot with the tab Claude Code of space notes named `name`, as a start of the mod names it. */
const namedTab = (name) => {
  const snap = record('claude-working.json')
  const spaces = snap.spaces.map((space) => ({ ...space, tabs: space.tabs.map((tab) => (tab.name === 'Claude Code' ? { ...tab, name } : tab)) }))
  return { ...snap, spaces }
}

/** The id Herdr gives the tab named `name` in space notes of `snap`. */
const tabId = (snap, name) => snap.spaces.find((space) => space.id === NOTES_SPACE).tabs.find((tab) => tab.name === name).id

test('rowSession finds the agent of tab idea-<id>, with the id of that tab', () => {
  const snap = namedTab('idea-2116')
  const id = tabId(snap, 'idea-2116')
  assert.equal(typeof id, 'string')
  assert.deepEqual(rowSession({ agents: snap.agents, spaces: snap.spaces, tab: 'idea-2116' }), { live: true, space: NOTES_SPACE, tab: id })
  // The same for the tab of a spec and of a plan.
  for (const tab of [docRef(245), 'plan-1597']) {
    const named = namedTab(tab)
    assert.deepEqual(rowSession({ agents: named.agents, spaces: named.spaces, tab }), { live: true, space: NOTES_SPACE, tab: tabId(named, tab) }, tab)
  }
  // Another tab name, or a name that only starts like it, is not the session of the row.
  assert.deepEqual(rowSession({ agents: snap.agents, spaces: snap.spaces, tab: 'idea-21' }), { live: false, space: null })
  assert.deepEqual(rowSession({ agents: snap.agents, spaces: snap.spaces, tab: 'idea-2117' }), { live: false, space: null })
})

test('rowSession: a tab whose agent is gone, or a space of another machine, is no session', () => {
  const snap = namedTab('idea-2116')
  const others = snap.agents.filter((agent) => agent.space !== NOTES_SPACE)
  assert.deepEqual(rowSession({ agents: others, spaces: snap.spaces, tab: 'idea-2116' }), { live: false, space: null })
  const remote = snap.spaces.map((space) => ({ ...space, machine: 'vps' }))
  assert.deepEqual(rowSession({ agents: snap.agents, spaces: remote, tab: 'idea-2116' }), { live: false, space: null })
  assert.deepEqual(rowSession({ agents: null, spaces: null, tab: 'idea-2116' }), { live: false, space: null })
})

test('Show terminal selects the space of the row, then its own tab among the others of that space', () => {
  // The idea and a spec are both open in the space of the root: the tab of the idea is the one shown.
  const snap = namedTab('idea-2116')
  const session = rowSession({ agents: snap.agents, spaces: snap.spaces, tab: 'idea-2116' })
  assert.deepEqual(showTerminalCommands(session), [
    ['space.select', { id: NOTES_SPACE }],
    ['tab.select', { id: tabId(snap, 'idea-2116') }]
  ])
  // A session known by its space alone (the lead session of an epic in its copy): the space.
  assert.deepEqual(showTerminalCommands({ live: true, space: 'sp1' }), [['space.select', { id: 'sp1' }]])
  // No session: nothing.
  assert.deepEqual(showTerminalCommands({ live: false, space: null }), [])
})
