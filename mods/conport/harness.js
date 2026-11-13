// The harnesses an epic can be led by, and the agents a preparation or a task is handed to.

/** @import { Result } from './refusals.js' */

/**
 * An agent as Herdr's `knownAgents()` answers it: its key, whether it is installed, its command.
 * @typedef {{key: string, installed?: boolean, run?: string[]}} KnownAgent
 */

/**
 * A harness with whether it can be started here and its command, null when it cannot.
 * @typedef {{kind: string, key: string, label: string, installed: boolean, run: string[] | null}} HarnessChoice
 */

/**
 * The subagent type of each role of an epic.
 * @typedef {typeof DEFAULT_ROLES} Roles
 */

/**
 * A role of an epic.
 * @typedef {keyof Roles} RoleKey
 */

/**
 * The kinds of CLI the mod knows (`--harness`, `--agent`) and their keys in Herdr's
 * `knownAgents()`. The command of each is the `run` Herdr answers, never a table of the mod.
 */
export const HARNESSES = [
  { kind: 'claude', key: 'claude', label: 'Claude Code' },
  { kind: 'codex', key: 'codex', label: 'Codex' },
  { kind: 'cursor', key: 'cursor', label: 'Cursor' }
]

/** The agent kinds that take their task as the last argument they are started with. */
export const PREPARE_AGENTS = HARNESSES.map((harness) => harness.kind)

/** The subagent type each role of an epic starts with: the types of the conport plugin. */
export const DEFAULT_ROLES = {
  implementer: 'conport:sdd-implementer',
  reviewer: 'conport:sdd-task-reviewer',
  gapHunter: 'conport:sdd-gap-hunter',
  finalReviewer: 'conport:sdd-final-reviewer'
}

/** The subagent type of a fix round whose implementer is gone: never chosen. */
export const FIXER_TYPE = 'conport:sdd-fixer'

/** A subagent type is a plain name: it goes into the text of a task and into a command line. */
export const ROLE_TYPE_FORM = /^[\w.:-]+$/

/**
 * Each harness with whether it can be started here and its command: a harness whose key
 * `knownAgents()` does not list, or lists as not installed, has no command.
 * @param {KnownAgent[] | null | undefined} knownAgents
 * @returns {HarnessChoice[]}
 */
export function harnessChoices(knownAgents) {
  const known = Array.isArray(knownAgents) ? knownAgents : []
  return HARNESSES.map((harness) => {
    const agent = known.find((entry) => entry?.key === harness.key)
    const run = agent?.installed === true && Array.isArray(agent.run) && agent.run.length > 0 ? [...agent.run] : null
    return { ...harness, installed: run !== null, run }
  })
}

/**
 * The command of harness `kind`, or the refusal `harness_missing` naming it.
 * @param {KnownAgent[] | null | undefined} knownAgents
 * @param {string} kind
 * @returns {Result<string[]>}
 */
export function harnessRun(knownAgents, kind) {
  const choice = harnessChoices(knownAgents).find((harness) => harness.kind === kind)
  if (choice?.run) return { ok: true, data: choice.run }
  return { ok: false, error: { code: 'harness_missing', fact: choice?.label ?? String(kind), action: '' } }
}
