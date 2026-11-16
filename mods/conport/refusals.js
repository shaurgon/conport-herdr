// What the mod tells the person when something refuses: one line with what is wrong and one
// action, an imperative that ends with a period. The CLI words its refusals for a terminal; the
// mod says the ones it knows by their code in its own words, any other with its own text and
// action, and one without an action with Refresh.

/**
 * A refusal: its code, what is wrong (`fact`) and the action, as the CLI, git or the mod gave
 * them; `worktree` is the copy a failed `git worktree add` left.
 * @typedef {{code: string, fact?: string, action?: string, worktree?: string}} Refusal
 */

/**
 * An answer that refused.
 * @typedef {{ok: false, error: Refusal}} Refused
 */

/**
 * An answer that holds what was asked for.
 * @template T
 * @typedef {{ok: true, data: T}} Ok
 */

/**
 * What an action of the mod answers: `{ok: true, data}`, or `{ok: false, error}`.
 * @template T
 * @typedef {Ok<T> | Refused} Result
 */

/** The action of a refusal nothing else can be done about here: read everything again. */
const REFRESH = 'press Refresh.'

/**
 * What is wrong and the one action, by code; `null` says what is wrong by the text git or the CLI gave.
 * @type {Record<string, [string | null, string]>}
 */
export const LINES = {
  npx_missing: ["npx is not found in Herdr's environment", 'install Node 18+ and press Refresh.'],
  no_api_key: ['No ConPort API key', 'add CONPORT_API_KEY to ~/.config/conport/.env and press Refresh.'],
  cli_timeout: ['The ConPort CLI did not answer in 300 s', 'check the network and press Refresh.'],
  epic_not_found: ['The epic is not among the open epics of the project', REFRESH],
  task_not_found: ['The task is not among the open tasks outside the epics', REFRESH],
  epic_ready: ['The epic is already ready to run', REFRESH],
  task_moved: ['The task no longer waits for this step', REFRESH],
  epic_not_ready: ['The epic has no spec or no plan', 'prepare it in the Prepare tab.'],
  epic_not_preparable: ['The epic is not ready to run for a reason preparation cannot fix', 'look at it in the Prepare tab.'],
  root_detached: ["The repository's main working copy is not on a branch, so the epic has no base", 'check out a branch in the main working copy.'],
  role_invalid: ['The subagent type is not a plain name', 'choose a type for the role from the list.'],
  no_project: ['The repository has no ConPort project', "enter the project's name or handle."],
  bad_output: ['The ConPort CLI answered in a way the mod does not expect', 'update the conport mod.'],
  git_failed: [null, REFRESH],
  cli_failed: [null, REFRESH]
}

/**
 * Quotes a word for a POSIX shell unless it needs no quoting.
 * @param {string} word
 * @returns {string}
 */
export function shellWord(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

const join = (/** @type {string} */ what, /** @type {string} */ action) => (action ? `${what} — ${action}` : what)

/**
 * An action of the mod that threw (Herdr refused a command, say): its text, and Refresh.
 * @param {unknown} error
 * @returns {Refusal}
 */
export function thrownRefusal(error) {
  const text = String(/** @type {{message?: unknown} | null | undefined} */ (error)?.message ?? error ?? '').trim()
  return { code: 'mod_failed', fact: text || 'An action of the mod failed', action: REFRESH }
}

/**
 * The line of a refusal `{code, fact, action}`. `harness_missing` names the harness in `fact`;
 * `worktree_failed` carries git's text in `fact` and the copy in `worktree`.
 * @param {Refusal} refusal
 * @returns {string}
 */
export function refusalLine({ code, fact = '', action = '', worktree = '' }) {
  if (code === 'harness_missing') return join(`${fact} not found`, 'install it or choose another.')
  // Herdr's exec rejects the same way for a missing folder: its own text tells which it was.
  if (code === 'npx_missing') return join(`${LINES.npx_missing[0]}${fact ? ` (${fact})` : ''}`, LINES.npx_missing[1])
  if (code === 'worktree_failed') {
    return join(fact, `remove the unfinished copy with git worktree remove --force ${shellWord(worktree)} and try again.`)
  }
  const known = LINES[code]
  if (known) return join(known[0] ?? (fact || code), known[1])
  // A refusal that came with no action of its own still gets one: read again.
  return join(fact || code, String(action ?? '').trim() ? action : REFRESH)
}
