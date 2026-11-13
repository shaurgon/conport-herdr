// Whether the lead session of an epic is alive, read from Herdr's live data. Herdr redraws the
// mod when that data changes: nothing here polls.
import { trimSlash } from './git.js'
import { HARNESSES } from './harness.js'

/** @import { AgentInfo, PaneInfo, SpaceInfo } from 'herdr' */

/**
 * Whether the lead session of an epic is alive, and the space of its pane.
 * @typedef {{live: boolean, space: string | null}} Session
 */

/**
 * The wait of Start after a start of epic `epic`; `missed` once its timer ran out unseen.
 * @typedef {{epic: number, missed: boolean}} Hold
 */

/**
 * A wait kept by the mod: the hold, its one-off timer, and the copy whose session ends it.
 * @typedef {{hold: Hold | null, task: {cancel(): void} | null, worktree: string}} HoldEntry
 */

const HARNESS_KEYS = new Set(HARNESSES.map((harness) => harness.key))

/** How long Start waits after a start before it gives up on seeing the agent. */
export const HOLD_MS = 60000

/**
 * `folder` is the copy `worktree` or a folder inside it.
 * @param {string | null | undefined} folder
 * @param {string} worktree
 * @returns {boolean}
 */
export function inside(folder, worktree) {
  if (typeof folder !== 'string' || folder === '') return false
  const copy = trimSlash(worktree)
  const path = trimSlash(folder)
  return path === copy || path.startsWith(`${copy}/`)
}

/** The spaces of this machine: the mod works with no other. */
export const localSpaces = (/** @type {SpaceInfo[] | null | undefined} */ spaces) => (spaces ?? []).filter((space) => space.machine === null)

/**
 * The id of the space of this machine that holds tab `tab`, or null.
 * @param {SpaceInfo[] | null | undefined} spaces
 * @param {string} tab
 * @returns {string | null}
 */
function spaceOfTab(spaces, tab) {
  return localSpaces(spaces).find((space) => (space.tabs ?? []).some((t) => t.id === tab))?.id ?? null
}

/**
 * The session of the epic whose copy is `worktree`: a terminal whose pane stands in the copy or
 * inside it, whatever its space is named — an agent of `agents()` with such a pane, or a pane
 * whose program is now a harness and that `agents()` does not list yet (Claude Code waiting on
 * the folder trust question reports no status). A pane where the agent quit by itself runs the
 * shell and is no session. `space` is the space of the pane.
 * @param {{agents: AgentInfo[] | null | undefined, panes: PaneInfo[] | null | undefined, spaces: SpaceInfo[] | null | undefined, worktree: string}} live
 * @returns {Session}
 */
export function epicSession({ agents, panes, spaces, worktree }) {
  const allPanes = panes ?? []
  const byId = new Map(allPanes.map((pane) => [pane.pane, pane]))
  for (const agent of agents ?? []) {
    const pane = byId.get(agent.pane)
    if (!pane || !inside(pane.cwd, worktree)) continue
    const space = spaceOfTab(spaces, pane.tab)
    if (space !== null) return { live: true, space }
  }
  // An agent of `agents()` in the copy was found above: what is left are panes it does not list.
  for (const pane of allPanes) {
    if (!inside(pane.cwd, worktree)) continue
    if (!HARNESS_KEYS.has(pane.program?.key)) continue
    const space = spaceOfTab(spaces, pane.tab)
    if (space !== null) return { live: true, space }
  }
  return { live: false, space: null }
}

/**
 * The space a start opens its lead tab in, or null for a new space `epic-<N>`: the space of the
 * live session (a start again); else the space of a pane standing in the copy (the agent quit
 * there); else a space `epic-<N>` of this machine whose folder is in the copy.
 * @param {{session: Session | null | undefined, spaces: SpaceInfo[], panes: PaneInfo[], worktree: string, epic: number}} live
 * @returns {string | null}
 */
export function launchSpace({ session, spaces, panes, worktree, epic }) {
  if (session?.live && session.space) return session.space
  for (const pane of panes ?? []) {
    if (!inside(pane.cwd, worktree)) continue
    const space = spaceOfTab(spaces, pane.tab)
    if (space !== null) return space
  }
  const named = localSpaces(spaces).find((space) => space.name === `epic-${epic}` && inside(space.folder, worktree))
  return named?.id ?? null
}

/**
 * The space of the project whose main checkout is `root`: a space of this machine with a pane
 * standing in the root or inside it, not inside another copy of the repository nested in the root
 * (`worktrees`, the paths `git worktree list` gave); null when there is none.
 * @param {{spaces: SpaceInfo[], panes: PaneInfo[], root: string, worktrees?: string[]}} live
 * @returns {string | null}
 */
export function rootSpace({ spaces, panes, root, worktrees = [] }) {
  const others = worktrees.filter((path) => trimSlash(path) !== trimSlash(root))
  for (const pane of panes ?? []) {
    if (!inside(pane.cwd, root)) continue
    if (others.some((path) => inside(pane.cwd, path))) continue
    const space = spaceOfTab(spaces, pane.tab)
    if (space !== null) return space
  }
  return null
}

/** The wait of Start right after epic `epic` was started. */
export const startHold = (/** @type {number} */ epic) => ({ epic, missed: false })

/**
 * The wait after `cause`: the session appeared (`session`) or Refresh was pressed (`refresh`)
 * end it; the one-off timer of HOLD_MS (`timer`) ends it with the line that the agent was not seen.
 * @param {Hold | null} hold
 * @param {'session' | 'refresh' | 'timer'} cause
 * @returns {Hold | null}
 */
export function releaseHold(hold, cause) {
  if (hold && cause === 'timer') return { ...hold, missed: true }
  return null
}

/**
 * Ends every wait whose session is seen now, as `releaseHold(…, 'session')` does, missed or not,
 * with its one-off timer: an agent that quits before the timer then leaves Start on. `holds` maps a key to `{ hold, task,
 * worktree }` and is changed in place; `sessionOf(worktree)` is the session of a copy.
 * @param {Record<string, HoldEntry>} holds
 * @param {(worktree: string) => Session} sessionOf
 */
export function endSeenHolds(holds, sessionOf) {
  for (const [key, entry] of Object.entries(holds)) {
    if (!sessionOf(entry.worktree).live) continue
    entry.task?.cancel()
    delete holds[key]
  }
}

/**
 * Whether Start is off, and the line under it.
 * @param {Hold | null | undefined} hold
 * @param {Session | null | undefined} session
 * @returns {{disabled: boolean, line: string | null}}
 */
export function holdState(hold, session) {
  if (!hold || session?.live) return { disabled: false, line: null }
  if (hold.missed) return { disabled: false, line: `The agent did not appear — look at the lead tab of space epic-${hold.epic}.` }
  return { disabled: true, line: `The agent is opening in space epic-${hold.epic}` }
}
