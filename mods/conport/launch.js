// The start of an epic, of an idea and of a spec, the answers to a proposal, and the arguments of
// the CLI's tasks and of Herdr's commands that open an agent. The task reaches the agent as the
// last element of `argv`, the argument it is started with: Herdr's `task` field is never used,
// since its first message is dropped when the agent is not ready in time (a folder trust
// question) and `run` does not say so.
import { isTimeout, rejectionText, runCli } from './cli.js'
import { epicPlace, epicRefsArgs, mainCheckout, parseWorktrees, worktreeAddArgs, WORKTREE_ADD_TIMEOUT_MS, worktreeListArgs } from './git.js'
import { DEFAULT_ROLES, harnessRun } from './harness.js'
import { epicSession, launchSpace, rootSpace } from './session.js'
import { agentKey, rememberStart } from './state.js'

/** @import { AgentInfo, PaneInfo, SpaceInfo } from 'herdr' */
/** @import { Exec, HandMode } from './cli.js' */
/** @import { Place, Worktree } from './git.js' */
/** @import { KnownAgent, Roles } from './harness.js' */
/** @import { Result } from './refusals.js' */

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
 * The arguments of the task of an agent that does, reviews or fixes an idea or a task of an epic
 * outside SDD.
 * @param {{task: number, project: string, mode: string, agent: string, root: string}} task
 * @returns {string[]}
 */
export function taskPromptArgs({ task, project, mode, agent, root }) {
  return ['prompt', 'task', String(task), '-p', project, '--host', 'herdr', '--mode', mode, '--agent', agent, '--root', root, '--json']
}

/**
 * What Plan & build plans: a spec document waiting for its plan, or an epic with a spec and no plan.
 * @typedef {{doc: number} | {epic: number}} SpecTarget
 */

/**
 * The arguments of the task of an agent that brainstorms idea `task` with the person.
 * @param {{task: number, project: string, agent: string, root: string}} task
 * @returns {string[]}
 */
export function ideaPromptArgs({ task, project, agent, root }) {
  return ['prompt', 'idea', String(task), '-p', project, '--host', 'herdr', '--agent', agent, '--root', root, '--json']
}

/**
 * The arguments of the task of an agent that plans a spec and builds it: `doc-<N>` for a spec
 * document, `task-<N>` for an epic; `base` the branch of the main checkout.
 * @param {{target: SpecTarget, project: string, agent: string, root: string, base: string}} task
 * @returns {string[]}
 */
export function specPromptArgs({ target, project, agent, root, base }) {
  const subject = 'doc' in target ? `doc-${target.doc}` : `task-${target.epic}`
  return ['prompt', 'spec', subject, '-p', project, '--host', 'herdr', '--agent', agent, '--root', root, '--base', base, '--json']
}

/**
 * The arguments that accept proposal `doc`: the CLI answers the idea it became.
 * @param {{doc: number, project: string}} proposal
 * @returns {string[]}
 */
export function proposalAcceptArgs({ doc, project }) {
  return ['proposal', 'accept', `doc-${doc}`, '-p', project, '--json']
}

/**
 * The arguments that decline proposal `doc` for `reason`.
 * @param {{doc: number, project: string, reason: string}} proposal
 * @returns {string[]}
 */
export function proposalDeclineArgs({ doc, project, reason }) {
  return ['proposal', 'decline', `doc-${doc}`, '-p', project, '--reason', reason, '--json']
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
 * Opens an agent on an idea or a task of an epic outside SDD (`kind` `do`, `review` or `fix`, `id`
 * the task): the task `prompt task` in a tab `task-<id>` in the root of the project, as
 * `openInRoot` does.
 *
 * `deps`: Herdr's `exec`, `run`, `setShared`, and `spaces` and `panes` as functions.
 * `input`: `{kind, id, agent, project, root, gitDir, knownAgents}`.
 * @param {RootDeps} deps
 * @param {RootStart & {kind: HandMode, id: number}} input
 * @returns {Promise<Result<Opened>>}
 */
export async function handToAgent(deps, input) {
  const { kind, id, agent, project, root } = input
  const args = taskPromptArgs({ task: id, project, mode: kind, agent, root })
  return openInRoot(deps, { ...input, name: `task-${id}`, args: () => ({ ok: true, data: args }) })
}

/**
 * What a start in the root needs, besides Herdr's functions.
 * @typedef {{agent: string, project: string, root: string, gitDir: string, knownAgents: KnownAgent[]}} RootStart
 */

/**
 * What a start in the root opened: the tab, and whether in a new space or in the space of the project.
 * @typedef {{name: string, command: 'space.new' | 'tab.new', space: string | null}} Opened
 */

/**
 * Herdr's functions a start in the root uses.
 * @typedef {{exec: Exec, run: Run, setShared: SetShared, spaces: () => SpaceInfo[], panes: () => PaneInfo[]}} RootDeps
 */

/**
 * Opens `agent` in tab `name` in the root of the project with the task the CLI answers to
 * `args(checkouts)`. The agent, the copies of the repository (`git worktree list`), the arguments
 * and the task from the CLI come first: a refusal opens nothing. Then the tab in the space of the
 * project — a pane in the main checkout, not in a copy nested in it — or a new space when there
 * is none; the agent is remembered for the project.
 * @param {RootDeps} deps
 * @param {RootStart & {name: string, args: (checkouts: Worktree[]) => Result<string[]>}} input
 * @returns {Promise<Result<Opened>>}
 */
async function openInRoot(deps, { agent, root, gitDir, knownAgents, name, args }) {
  const { exec, run, setShared } = deps
  const command = harnessRun(knownAgents, agent)
  if (command.ok === false) return command
  const listed = await runGit(exec, worktreeListArgs(root), undefined, 'git_failed')
  if (listed.ok === false) return listed
  const checkouts = parseWorktrees(listed.data)
  const built = args(checkouts)
  if (built.ok === false) return built

  const answer = await runCli(exec, built.data, root)
  if (answer.ok === false) return answer
  const text = answer.data?.text
  if (typeof text !== 'string' || text === '') {
    return { ok: false, error: { code: 'bad_output', fact: 'the CLI answered with no task', action: '' } }
  }

  const worktrees = checkouts.map((row) => row.path)
  const space = rootSpace({ spaces: deps.spaces(), panes: deps.panes(), root, worktrees })
  if (space === null) run('space.new', projectSpaceArgs({ root, name, run: command.data, text }))
  else run('tab.new', tabNewArgs({ space, name, folder: root, run: command.data, text }))
  setShared(agentKey(gitDir), agent)
  return { ok: true, data: { name, command: space === null ? 'space.new' : 'tab.new', space } }
}

/**
 * Opens an agent on idea `task` (Brainstorm): the task `prompt idea` in a tab `idea-<id>` in the
 * root of the project, as `openInRoot` does.
 * @param {RootDeps} deps
 * @param {RootStart & {task: number}} input
 * @returns {Promise<Result<Opened>>}
 */
export async function startIdea(deps, input) {
  const { task, project, agent, root } = input
  return openInRoot(deps, { ...input, name: `idea-${task}`, args: () => ({ ok: true, data: ideaPromptArgs({ task, project, agent, root }) }) })
}

/**
 * Opens an agent that plans a spec and builds it (Plan & build): the task `prompt spec` with the
 * branch of the main checkout as its base, in a tab `doc-<N>` for a spec document or
 * `plan-<epic>` for an epic, in the root of the project, as `openInRoot` does.
 * @param {RootDeps} deps
 * @param {RootStart & {target: SpecTarget}} input
 * @returns {Promise<Result<Opened>>}
 */
export async function startSpec(deps, input) {
  const { target, project, agent, root } = input
  const name = 'doc' in target ? `doc-${target.doc}` : `plan-${target.epic}`
  return openInRoot(deps, {
    ...input,
    name,
    args: (checkouts) => {
      const main = mainCheckout(checkouts)
      return main.ok === false ? main : { ok: true, data: specPromptArgs({ target, project, agent, root, base: main.data.base }) }
    }
  })
}

/**
 * Accepts proposal `doc` (the first step of its Brainstorm): the CLI answers the idea the
 * proposal became, the same one when it was accepted before. It opens nothing.
 * @param {{exec: Exec}} deps
 * @param {{doc: number, project: string, root: string}} input
 * @returns {Promise<Result<{task: number}>>}
 */
export async function acceptProposal({ exec }, { doc, project, root }) {
  const answer = await runCli(exec, proposalAcceptArgs({ doc, project }), root)
  if (answer.ok === false) return answer
  const task = answer.data?.task
  if (!Number.isInteger(task) || task <= 0) {
    return { ok: false, error: { code: 'bad_output', fact: 'the CLI answered with no task number', action: '' } }
  }
  return { ok: true, data: { task } }
}

/**
 * Declines proposal `doc` for `reason`; a reason is required, and without one the CLI is not run.
 * @param {{exec: Exec}} deps
 * @param {{doc: number, project: string, root: string, reason?: string | null}} input
 * @returns {Promise<Result<null>>}
 */
export async function declineProposal({ exec }, { doc, project, root, reason }) {
  const said = String(reason ?? '').trim()
  if (said === '') return { ok: false, error: { code: 'reason_missing', fact: '', action: '' } }
  const answer = await runCli(exec, proposalDeclineArgs({ doc, project, reason: said }), root)
  if (answer.ok === false) return answer
  return { ok: true, data: null }
}
