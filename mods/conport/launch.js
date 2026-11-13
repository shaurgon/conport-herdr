// The start of an epic, and the arguments of the CLI's tasks and of Herdr's commands that open
// an agent. The task reaches the agent as the last element of `argv`, the argument it is started
// with: Herdr's `task` field is never used, since its first message is dropped when the agent is
// not ready in time (a folder trust question) and `run` does not say so.
import { isTimeout, rejectionText, runCli } from './cli.js'
import { epicPlace, epicRefsArgs, parseWorktrees, worktreeAddArgs, WORKTREE_ADD_TIMEOUT_MS, worktreeListArgs } from './git.js'
import { DEFAULT_ROLES, harnessRun } from './harness.js'
import { epicSession, launchSpace, rootSpace } from './session.js'
import { agentKey, rememberStart } from './state.js'

/** @import { AgentInfo, PaneInfo, SpaceInfo } from 'herdr' */
/** @import { Exec, HandMode } from './cli.js' */
/** @import { Place } from './git.js' */
/** @import { KnownAgent, Roles } from './harness.js' */
/** @import { Result } from './refusals.js' */

/**
 * What a sheet hands to an agent: the preparation of an epic (`spec`, `plan`) or a task outside
 * the epics (a hand mode).
 * @typedef {'spec' | 'plan' | HandMode} SheetKind
 */

/**
 * Herdr's `run`: a command by its name, with its arguments.
 * @typedef {(name: string, args?: Record<string, unknown>) => unknown} Run
 */

/**
 * Herdr's `setShared`.
 * @typedef {(key: string, value: unknown) => unknown} SetShared
 */

/**
 * The arguments, after `npx -y conport@<V>`, of the task of the lead session of an epic: its
 * copy, its base and the four role types (the CLI tells them only to Claude Code).
 * @param {{epic: number, project: string, harness: string, worktree: string, base: string, roles?: Partial<Roles>}} task
 * @returns {string[]}
 */
export function epicPromptArgs({ epic, project, harness, worktree, base, roles = DEFAULT_ROLES }) {
  const types = { ...DEFAULT_ROLES, ...roles }
  return [
    'prompt', 'epic', String(epic), '-p', project, '--harness', harness, '--worktree', worktree, '--base', base,
    '--implementer', types.implementer, '--reviewer', types.reviewer, '--gap-hunter', types.gapHunter,
    '--final-reviewer', types.finalReviewer, '--json'
  ]
}

/**
 * The arguments of the task of an agent that prepares an epic with the person.
 * @param {{epic: number, project: string}} task
 * @returns {string[]}
 */
export function preparePromptArgs({ epic, project }) {
  return ['prompt', 'prepare', String(epic), '-p', project, '--host', 'herdr', '--json']
}

/**
 * The arguments of the task of an agent that does, reviews or fixes a task outside the epics.
 * @param {{task: number, project: string, mode: string, agent: string, root: string}} task
 * @returns {string[]}
 */
export function taskPromptArgs({ task, project, mode, agent, root }) {
  return ['prompt', 'task', String(task), '-p', project, '--host', 'herdr', '--mode', mode, '--agent', agent, '--root', root, '--json']
}

/**
 * `space.new` of the lead session: the space epic-<N> in the copy, its tab lead, on this machine.
 * @param {{epic: number, worktree: string, run: string[], text: string}} lead
 */
export function spaceNewArgs({ epic, worktree, run, text }) {
  return { name: `epic-${epic}`, folder: worktree, tab: 'lead', argv: [...run, text], machine: '' }
}

/**
 * `tab.new` in a space: always with its folder, or Herdr would take the folder of the focus.
 * @param {{space: string, name: string, folder: string, run: string[], text: string}} tab
 */
export function tabNewArgs({ space, name, folder, run, text }) {
  return { space, name, folder, argv: [...run, text] }
}

/**
 * `space.new` of a project that has no space here: in its root, the tab named, on this machine.
 * @param {{root: string, name: string, run: string[], text: string}} tab
 */
export function projectSpaceArgs({ root, name, run, text }) {
  return { folder: root, tab: name, argv: [...run, text], machine: '' }
}

const lastLine = (/** @type {string | null | undefined} */ text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)

/**
 * A git call through exec: its standard output, or the refusal `code` with what git said.
 * @param {Exec} exec
 * @param {string[]} args
 * @param {{timeout?: number} | undefined} options
 * @param {string} code
 * @returns {Promise<Result<string>>}
 */
async function runGit(exec, args, options, code) {
  let result
  try {
    result = await exec('git', args, options)
  } catch (error) {
    const late = isTimeout(error) && options?.timeout === WORKTREE_ADD_TIMEOUT_MS
    const fact = late ? 'git worktree add did not finish in 600 s' : rejectionText(error) || 'git did not start'
    return { ok: false, error: { code, fact, action: '' } }
  }
  if (result.code !== 0) {
    return { ok: false, error: { code, fact: lastLine(result.stderr) ?? `git: exit code ${result.code}`, action: '' } }
  }
  return { ok: true, data: result.stdout }
}

/**
 * Where epic `epic` runs (`epicPlace`), read by git from `folder`, any folder of its repository:
 * its checkouts (`git worktree list`), then its branches (`git for-each-ref`). It only reads.
 * @param {Exec} exec
 * @param {{folder: string, epic: number, home: string}} where
 * @returns {Promise<Result<Place>>}
 */
export async function readPlace(exec, { folder, epic, home }) {
  const listed = await runGit(exec, worktreeListArgs(folder), undefined, 'git_failed')
  if (listed.ok === false) return listed
  const worktrees = parseWorktrees(listed.data)
  // No checkout listed: epicPlace refuses it, and git is not asked for branches of no root.
  /** @type {Result<string>} */
  const refs = worktrees.length === 0 ? { ok: true, data: '' } : await runGit(exec, epicRefsArgs(worktrees[0].path, epic), undefined, 'git_failed')
  if (refs.ok === false) return refs
  return epicPlace({ worktrees, refs: refs.data, epic, home })
}

/**
 * Starts epic `epic` with `harness`. Everything that can refuse comes before a branch or a copy
 * is made: the harness, the root and the copy of the epic (`git worktree list`), its branches
 * (`git for-each-ref`), then the task from the CLI. Only then the copy, when it is not there
 * (`git worktree add`), and the lead tab: a new space `epic-<N>`, or a tab in the space the epic
 * already has. What was chosen is remembered for the epic and the project.
 *
 * `deps`: Herdr's `exec` and `run`, `setShared`, the home folder `home`, and its live data as
 * functions (`spaces`, `panes`, `agents`), read once the copy is there.
 * `input`: `{epic, project, harness, roles, folder, gitDir, knownAgents}` — `folder` is any
 * folder of the repository, `gitDir` its absolute git directory.
 * @param {{exec: Exec, run: Run, setShared: SetShared, home: string, spaces: () => SpaceInfo[], panes: () => PaneInfo[], agents: () => AgentInfo[]}} deps
 * @param {{epic: number, project: string, harness: string, roles?: Partial<Roles>, folder: string, gitDir: string, knownAgents: KnownAgent[]}} input
 * @returns {Promise<Result<{worktree: string, base: string, copy: Place['copy'], command: 'space.new' | 'tab.new', space: string | null}>>}
 */
export async function startEpic(deps, input) {
  const { exec, run, setShared, home } = deps
  const { epic, project, harness, folder, gitDir, knownAgents } = input
  const roles = { ...DEFAULT_ROLES, ...input.roles }

  const command = harnessRun(knownAgents, harness)
  if (command.ok === false) return command

  const place = await readPlace(exec, { folder, epic, home })
  if (place.ok === false) return place
  const { root, worktree, base, copy } = place.data

  const answer = await runCli(exec, epicPromptArgs({ epic, project, harness, worktree, base, roles }), root)
  if (answer.ok === false) return answer
  const text = answer.data?.text
  if (typeof text !== 'string' || text === '') {
    return { ok: false, error: { code: 'bad_output', fact: 'the CLI answered with no task', action: '' } }
  }

  if (copy !== 'existing') {
    const added = await runGit(
      exec,
      worktreeAddArgs({ root, worktree, epic, base, branch: copy === 'branch' }),
      { timeout: WORKTREE_ADD_TIMEOUT_MS },
      'worktree_failed'
    )
    if (added.ok === false) return { ok: false, error: { ...added.error, worktree } }
  }

  const spaces = deps.spaces()
  const panes = deps.panes()
  const session = epicSession({ agents: deps.agents(), panes, spaces, worktree })
  const space = launchSpace({ session, spaces, panes, worktree, epic })
  if (space === null) run('space.new', spaceNewArgs({ epic, worktree, run: command.data, text }))
  else run('tab.new', tabNewArgs({ space, name: 'lead', folder: worktree, run: command.data, text }))
  rememberStart(setShared, gitDir, { epic, harness, roles })
  return { ok: true, data: { worktree, base, copy, command: space === null ? 'space.new' : 'tab.new', space } }
}

/**
 * The sheets that prepare an epic: their task is the same, by what the epic lacks.
 * @type {SheetKind[]}
 */
const PREPARE_KINDS = ['spec', 'plan']

/**
 * Opens an agent on the preparation of an epic (`kind` `spec` or `plan`, `id` the epic) or on a
 * task outside the epics (`kind` `do`, `review` or `fix`, `id` the task). The agent, the copies
 * of the repository (`git worktree list`) and the task from the CLI come first: a refusal opens
 * nothing. Then a tab `prepare-<N>` / `task-<id>` in the root of the project, in the space of the
 * project — a pane in the main checkout, not in a copy nested in it — or a new space when there is
 * none; the agent is remembered for the project.
 *
 * `deps`: Herdr's `exec`, `run`, `setShared`, and `spaces` and `panes` as functions.
 * `input`: `{kind, id, agent, project, root, gitDir, knownAgents}`.
 * @param {{exec: Exec, run: Run, setShared: SetShared, spaces: () => SpaceInfo[], panes: () => PaneInfo[]}} deps
 * @param {{kind: SheetKind, id: number, agent: string, project: string, root: string, gitDir: string, knownAgents: KnownAgent[]}} input
 * @returns {Promise<Result<{name: string, command: 'space.new' | 'tab.new', space: string | null}>>}
 */
export async function handToAgent(deps, input) {
  const { exec, run, setShared } = deps
  const { kind, id, agent, project, root, gitDir, knownAgents } = input
  const command = harnessRun(knownAgents, agent)
  if (command.ok === false) return command
  const listed = await runGit(exec, worktreeListArgs(root), undefined, 'git_failed')
  if (listed.ok === false) return listed
  const worktrees = parseWorktrees(listed.data).map((row) => row.path)

  const prepare = PREPARE_KINDS.includes(kind)
  const args = prepare ? preparePromptArgs({ epic: id, project }) : taskPromptArgs({ task: id, project, mode: kind, agent, root })
  const answer = await runCli(exec, args, root)
  if (answer.ok === false) return answer
  const text = answer.data?.text
  if (typeof text !== 'string' || text === '') {
    return { ok: false, error: { code: 'bad_output', fact: 'the CLI answered with no task', action: '' } }
  }

  const name = prepare ? `prepare-${id}` : `task-${id}`
  const space = rootSpace({ spaces: deps.spaces(), panes: deps.panes(), root, worktrees })
  if (space === null) run('space.new', projectSpaceArgs({ root, name, run: command.data, text }))
  else run('tab.new', tabNewArgs({ space, name, folder: root, run: command.data, text }))
  setShared(agentKey(gitDir), agent)
  return { ok: true, data: { name, command: space === null ? 'space.new' : 'tab.new', space } }
}
