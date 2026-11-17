// What the mod remembers in Herdr's shared state. Every key starts with `conport:` and the
// absolute git directory of the repository (`git rev-parse --path-format=absolute
// --git-common-dir`), so the root and every checkout of one repository share them.
import { trimSlash } from './git.js'
import { DEFAULT_ROLES } from './harness.js'

/** @import { Roles } from './harness.js' */

const PREFIX = 'conport:'

/**
 * `conport:<git dir>:<part>:…`
 * @param {string} gitDir
 * @param {...(string | number)} parts
 * @returns {string}
 */
export function sharedKey(gitDir, ...parts) {
  return [`${PREFIX}${trimSlash(gitDir)}`, ...parts.map(String)].join(':')
}

/** The harness and the four role types of an epic, written by its start. */
export const epicKey = (/** @type {string} */ gitDir, /** @type {number} */ epic) => sharedKey(gitDir, 'epic', epic)

/** The harness of the last start in the project: the one a new epic starts with. */
export const harnessKey = (/** @type {string} */ gitDir) => sharedKey(gitDir, 'harness')

/** The agent last chosen to brainstorm an idea, plan and build a spec, or take a task. */
export const agentKey = (/** @type {string} */ gitDir) => sharedKey(gitDir, 'agent')

/** The ConPort project the person bound the repository to. */
export const bindingKey = (/** @type {string} */ gitDir) => sharedKey(gitDir, 'project')

/**
 * Writes what a start of an epic chose.
 * @param {(key: string, value: unknown) => unknown} setShared
 * @param {string} gitDir
 * @param {{epic: number, harness: string, roles: Roles}} start
 */
export function rememberStart(setShared, gitDir, { epic, harness, roles }) {
  setShared(epicKey(gitDir, epic), { harness, roles: { ...roles } })
  setShared(harnessKey(gitDir), harness)
}

/** @returns {string | null} */
const name = (/** @type {unknown} */ value) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * The harness and roles an epic shows: what its last start chose; else the harness of the last
 * start in the project, or Claude Code, with the default roles.
 * @param {(key: string) => unknown} shared
 * @param {string} gitDir
 * @param {number} epic
 * @returns {{harness: string, roles: Roles}}
 */
export function chosenFor(shared, gitDir, epic) {
  // What the shared state holds is whatever was written there: every field is read as unknown.
  const stored = /** @type {{harness?: unknown, roles?: unknown} | null | undefined} */ (shared(epicKey(gitDir, epic)))
  const roles = stored && typeof stored === 'object' ? stored.roles : null
  const kept = /** @type {Record<string, unknown>} */ (roles && typeof roles === 'object' ? roles : {})
  const whole = Object.keys(DEFAULT_ROLES).every((role) => name(kept[role]) !== null)
  return {
    harness: name(stored?.harness) ?? name(shared(harnessKey(gitDir))) ?? 'claude',
    roles: whole ? /** @type {Roles} */ (Object.fromEntries(Object.keys(DEFAULT_ROLES).map((role) => [role, kept[role]]))) : { ...DEFAULT_ROLES }
  }
}
