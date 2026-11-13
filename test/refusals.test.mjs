import assert from 'node:assert/strict'
import test from 'node:test'
import { runCli } from '../mods/conport/cli.js'
import { LINES, refusalLine, thrownRefusal } from '../mods/conport/refusals.js'

// The English fact and action of the CLI never reach the person for a code the mod words itself.
const line = (code, extra = {}) => refusalLine({ code, fact: 'an English fact', action: 'an English action', ...extra })

test('each refusal of the spec is one English line with what is wrong and one action', () => {
  const lines = {
    no_api_key: 'No ConPort API key — add CONPORT_API_KEY to ~/.config/conport/.env and press Refresh.',
    cli_timeout: 'The ConPort CLI did not answer in 300 s — check the network and press Refresh.',
    epic_not_found: 'The epic is not among the open epics of the project — press Refresh.',
    task_not_found: 'The task is not among the open tasks outside the epics — press Refresh.',
    epic_ready: 'The epic is already ready to run — press Refresh.',
    task_moved: 'The task no longer waits for this step — press Refresh.',
    epic_not_ready: 'The epic has no spec or no plan — prepare it in the Prepare tab.',
    epic_not_preparable: 'The epic is not ready to run for a reason preparation cannot fix — look at it in the Prepare tab.',
    epic_started_workflow: 'The epic was started by the /conport:epic workflow — resume it in Orca in the /conport:epic mode.',
    root_detached: "The repository's main working copy is not on a branch, so the epic has no base — check out a branch in the main working copy.",
    role_invalid: 'The subagent type is not a plain name — choose a type for the role from the list.',
    no_project: "The repository has no ConPort project — enter the project's name or handle."
  }
  for (const [code, expected] of Object.entries(lines)) assert.equal(line(code), expected, code)
})

test('npx_missing carries the text of the rejection: exec rejects alike for a missing folder', () => {
  assert.equal(
    refusalLine({ code: 'npx_missing', fact: 'No such file or directory (os error 2)', action: 'x' }),
    "npx is not found in Herdr's environment (No such file or directory (os error 2)) — install Node 18+ and press Refresh."
  )
  assert.equal(refusalLine({ code: 'npx_missing', fact: '', action: '' }), "npx is not found in Herdr's environment — install Node 18+ and press Refresh.")
})

test('a harness or an agent that is not installed is named, with the one action', () => {
  assert.equal(line('harness_missing', { fact: 'Cursor' }), 'Cursor not found — install it or choose another.')
})

test('a failed git worktree add says what git said and how to remove the unfinished copy', () => {
  assert.equal(
    refusalLine({ code: 'worktree_failed', fact: "fatal: 'epic-7' is already used by worktree", action: '', worktree: '/w/acme-app/epic-7' }),
    "fatal: 'epic-7' is already used by worktree — remove the unfinished copy with git worktree remove --force /w/acme-app/epic-7 and try again."
  )
  // A path the person copies into a shell is quoted when it needs it.
  assert.equal(
    refusalLine({ code: 'worktree_failed', fact: 'git worktree add did not finish in 600 s', action: '', worktree: "/w/my repo/it's" }),
    "git worktree add did not finish in 600 s — remove the unfinished copy with git worktree remove --force '/w/my repo/it'\\''s' and try again."
  )
})

test('every refusal the mod words itself ends with one non-empty action, a sentence that ends with a period', () => {
  for (const [code, [, action]] of Object.entries(LINES)) {
    assert.ok(typeof action === 'string' && action.trim() !== '', `${code} has no action`)
    assert.match(action, /^[a-z].*\.$/, code)
    assert.ok(refusalLine({ code, fact: 'x', action: '' }).endsWith(` — ${action}`), code)
  }
})

test('a refusal of git or of the CLI keeps their text and tells to press Refresh', () => {
  assert.equal(
    refusalLine({ code: 'git_failed', fact: 'fatal: not a git repository', action: '' }),
    'fatal: not a git repository — press Refresh.'
  )
  assert.equal(
    refusalLine({ code: 'cli_failed', fact: 'something broke', action: '' }),
    'something broke — press Refresh.'
  )
  assert.equal(refusalLine({ code: 'git_failed', fact: '', action: '' }), 'git_failed — press Refresh.')
})

// Every refusal the mod makes itself, as it makes it: the code and the action it passes.
const MOD_REFUSALS = [
  { code: 'npx_missing', fact: 'x', action: '' }, // cli.js: exec could not start npx
  { code: 'cli_timeout', fact: 'x', action: '' }, // cli.js: exec ran out of time
  { code: 'cli_failed', fact: 'x', action: '' }, // cli.js: a failed run with no refusal on stderr
  { code: 'bad_output', fact: 'x', action: '' }, // cli.js, launch.js: an answer the mod cannot read
  { code: 'git_failed', fact: 'x', action: '' }, // git.js, launch.js: a failed git command
  { code: 'epic_started_workflow', fact: 'x', action: '' }, // git.js
  { code: 'root_detached', fact: 'x', action: '' }, // git.js
  { code: 'worktree_failed', fact: 'x', action: '', worktree: '/w/x' }, // launch.js
  { code: 'harness_missing', fact: 'Cursor', action: '' }, // harness.js, main.js
  { code: 'no_project' }, // main.js
  { code: 'agents_unknown', fact: 'x', action: 'press Refresh.' }, // main.js, with its own action
  thrownRefusal(new Error('x')) // refusals.js: an action of the mod that threw
]

test('every refusal the mod makes itself ends with one non-empty action', () => {
  for (const refusal of MOD_REFUSALS) {
    const said = refusalLine(refusal)
    const at = said.lastIndexOf(' — ')
    assert.ok(at > 0 && said.slice(at + 3).trim() !== '', `${refusal.code}: ${said}`)
  }
})

test('a refusal of the CLI with no action of its own tells to press Refresh', async () => {
  const body = { ok: false, error: { code: 'epic_locked', message: 'the epic is locked', action: '' } }
  const exec = async () => ({ code: 1, stdout: JSON.stringify(body), stderr: '' })
  const answer = await runCli(exec, ['epic', 'list'], '/r')
  assert.deepEqual(answer.error, { code: 'epic_locked', fact: 'the epic is locked', action: '' })
  assert.equal(refusalLine(answer.error), 'the epic is locked — press Refresh.')
  assert.equal(refusalLine({ code: 'http_500', fact: '', action: '' }), 'http_500 — press Refresh.')
  assert.equal(refusalLine({ code: 'http_500', fact: 'x', action: '  ' }), 'x — press Refresh.')
})

test('any other refusal of the CLI is said as it is, with its own action', () => {
  assert.equal(
    refusalLine({ code: 'subagents_unavailable', fact: 'claude plugin list failed', action: 'install Claude Code' }),
    'claude plugin list failed — install Claude Code'
  )
})

test('thrownRefusal: an action that threw is told by its text, with Refresh as the action', () => {
  const refusal = thrownRefusal(new Error('layout unavailable'))
  assert.deepEqual(refusal, { code: 'mod_failed', fact: 'layout unavailable', action: 'press Refresh.' })
  assert.equal(refusalLine(refusal), 'layout unavailable — press Refresh.')
  assert.equal(thrownRefusal('plain').fact, 'plain')
  assert.equal(thrownRefusal(undefined).fact, 'An action of the mod failed')
})
