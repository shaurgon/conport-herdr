import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_ROLES } from '../mods/conport/harness.js'
import {
  acceptProposal,
  declineProposal,
  epicPromptArgs,
  handToAgent,
  ideaPromptArgs,
  projectSpaceArgs,
  proposalAcceptArgs,
  proposalDeclineArgs,
  readPlace,
  spaceNewArgs,
  specPromptArgs,
  startEpic,
  startIdea,
  startSpec,
  tabNewArgs,
  taskPromptArgs
} from '../mods/conport/launch.js'
import { agentKey, epicKey, harnessKey } from '../mods/conport/state.js'
import { CLI_VERSION } from '../mods/conport/version.js'
import { git, HOME, record, repository, scratch } from './records.mjs'

/** A document as the CLI names it: `doc-<N>`, the number never written out. */
const docRef = (n) => `doc-${n}`

const ROOT = `${HOME}/src/acme-app`
const GIT_DIR = `${ROOT}/.git`
const W = (epic) => `${HOME}/.herdr/worktrees/acme-app/epic-${epic}`

/** A task of about 11000 characters with every character a shell or JSON would trip on. */
const LONG_TASK = (() => {
  const lines = [
    'Reply with the last line of this task only.',
    `It's "quoted", \`backticked\`, $HOME, \${PATH}, $(whoami), a \\ backslash, \\n and \\t written out.`,
    'Ελληνικά, accents é à ü, 漢字',
    '',
    '\ttabbed line'
  ]
  while (lines.join('\n').length < 10950) lines.push(`step ${lines.length}: «${'x'.repeat(60)}» 'single' "double"`)
  lines.push('END-OF-TASK-7f3a')
  return lines.join('\n')
})()

test('the long task is about 11000 characters', () => {
  assert.ok(LONG_TASK.length > 10900 && LONG_TASK.length < 11200, String(LONG_TASK.length))
})

test('epicPromptArgs: the task of an epic with the copy, the base and the four roles, as JSON', () => {
  const roles = { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' }
  assert.deepEqual(epicPromptArgs({ epic: 412, project: 'prk7m2qx9d', harness: 'claude', worktree: W(412), base: 'main', roles }), [
    'prompt', 'epic', '412', '-p', 'prk7m2qx9d', '--harness', 'claude', '--worktree', W(412), '--base', 'main',
    '--implementer', 'conport:sdd-implementer', '--reviewer', 'mine:reviewer', '--gap-hunter', 'conport:sdd-gap-hunter',
    '--final-reviewer', 'conport:sdd-final-reviewer', '--json'
  ])
  // No roles named: the default types.
  const plain = epicPromptArgs({ epic: 7, project: 'p', harness: 'codex', worktree: '/w', base: 'main' })
  assert.equal(plain[plain.indexOf('--implementer') + 1], 'conport:sdd-implementer')
  assert.ok(!plain.includes('--host'))
})

test('taskPromptArgs names the host herdr and asks for JSON', () => {
  assert.deepEqual(taskPromptArgs({ task: 31, project: 'p', mode: 'fix', agent: 'codex', root: '/my repo' }), [
    'prompt', 'task', '31', '-p', 'p', '--host', 'herdr', '--mode', 'fix', '--agent', 'codex', '--root', '/my repo', '--json'
  ])
})

test('ideaPromptArgs and specPromptArgs: the tasks of an idea and of a spec name the host herdr, the agent and the root', () => {
  assert.deepEqual(ideaPromptArgs({ task: 2116, project: 'p', agent: 'codex', root: '/my repo' }), [
    'prompt', 'idea', '2116', '-p', 'p', '--host', 'herdr', '--agent', 'codex', '--root', '/my repo', '--json'
  ])
  assert.deepEqual(specPromptArgs({ target: { doc: 245 }, project: 'p', agent: 'claude', root: '/r', base: 'trunk' }), [
    'prompt', 'spec', docRef(245), '-p', 'p', '--host', 'herdr', '--agent', 'claude', '--root', '/r', '--base', 'trunk', '--json'
  ])
  assert.deepEqual(specPromptArgs({ target: { epic: 1597 }, project: 'p', agent: 'cursor', root: '/r', base: 'main' }), [
    'prompt', 'spec', 'task-1597', '-p', 'p', '--host', 'herdr', '--agent', 'cursor', '--root', '/r', '--base', 'main', '--json'
  ])
})

test('proposalAcceptArgs and proposalDeclineArgs name the proposal as doc-<N>, the reason as it is', () => {
  assert.deepEqual(proposalAcceptArgs({ doc: 301, project: 'p' }), ['proposal', 'accept', docRef(301), '-p', 'p', '--json'])
  assert.deepEqual(proposalDeclineArgs({ doc: 301, project: 'p', reason: "Out of scope: it's another team's" }), [
    'proposal', 'decline', docRef(301), '-p', 'p', '--reason', "Out of scope: it's another team's", '--json'
  ])
})

test('spaceNewArgs: the space epic-<N> in the copy, the tab lead, the task last in argv, on this machine', () => {
  const [recorded] = record('launch.json')
  const args = spaceNewArgs({ epic: 412, worktree: W(412), run: ['claude'], text: LONG_TASK })
  assert.deepEqual(Object.keys(args).sort(), Object.keys(recorded.args).sort())
  assert.deepEqual({ ...args, argv: args.argv.slice(0, -1) }, { ...recorded.args, argv: recorded.args.argv.slice(0, -1) })
  assert.equal(args.machine, '')
  assert.equal(args.folder, W(412))
  assert.equal(args.argv.at(-1), LONG_TASK)
  assert.ok(!('task' in args))
})

test('tabNewArgs: a tab of the space, always with its folder, the task last in argv', () => {
  const recorded = record('launch.json')[3]
  const args = tabNewArgs({ space: '<id of space epic-413>', name: 'lead', folder: W(413), run: ['codex', '--no-daemon'], text: LONG_TASK })
  assert.deepEqual({ ...args, argv: args.argv.slice(0, -1) }, { ...recorded.args, argv: recorded.args.argv.slice(0, -1) })
  assert.equal(args.argv.at(-1), LONG_TASK)
  assert.ok(!('task' in args))
})

test('the run of the harness is not changed by an argv built from it', () => {
  const run = ['codex', '--no-daemon']
  spaceNewArgs({ epic: 1, worktree: '/w', run, text: 't' })
  tabNewArgs({ space: 's', name: 'lead', folder: '/w', run, text: 't' })
  assert.deepEqual(run, ['codex', '--no-daemon'])
})

/**
 * The world startEpic sees: git answering from the records, the CLI answering with `cli`, and
 * Herdr's live data from a snapshot. Every call is logged in order.
 */
function world({ worktrees = 'git-worktree-list.json', refs = 'git-for-each-ref-none.json', cli, add, snap = 'claude-working.json' } = {}) {
  const log = []
  const shared = new Map()
  const live = record(snap)
  const exec = async (command, args, options) => {
    log.push({ step: 'exec', command, args, options })
    if (command === 'npx') return cli ? cli(args) : { code: 0, stdout: JSON.stringify({ ok: true, text: LONG_TASK }), stderr: '' }
    if (args.includes('list')) return { code: 0, stdout: record(worktrees).stdout, stderr: '' }
    if (args.includes('for-each-ref')) return { code: 0, stdout: record(refs).stdout, stderr: '' }
    if (args.includes('add')) return add ? add(args) : { code: 0, stdout: '', stderr: '' }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  const deps = {
    exec,
    run: (name, args) => {
      log.push({ step: 'run', name, args })
      return null
    },
    setShared: (key, value) => {
      log.push({ step: 'setShared', key })
      shared.set(key, value)
      return null
    },
    home: HOME,
    spaces: () => live.spaces,
    panes: () => live.panes,
    agents: () => live.agents
  }
  return { deps, log, shared }
}

const input = (epic, extra = {}) => ({
  epic,
  project: 'prk7m2qx9d',
  harness: 'claude',
  roles: DEFAULT_ROLES,
  folder: `${ROOT}/backend`,
  gitDir: GIT_DIR,
  knownAgents: record('known-agents.json'),
  ...extra
})

const steps = (log) =>
  log.map((entry) =>
    entry.step === 'exec'
      ? `${entry.command} ${entry.command === 'npx' ? entry.args.slice(2, 4).join(' ') : entry.args.slice(2, 5).join(' ')}`
      : entry.step === 'run'
      ? `run ${entry.name}`
      : 'setShared'
  )

test('startEpic: git first, then the task from the CLI, then git worktree add, then the space', async () => {
  const { deps, log, shared } = world()
  const started = await startEpic(deps, input(415))
  assert.deepEqual(started, {
    ok: true,
    data: { worktree: W(415), base: 'main', copy: 'new', command: 'space.new', space: null }
  })
  assert.deepEqual(steps(log), [
    'git worktree list --porcelain',
    'git for-each-ref refs/heads/epic-415',
    'npx prompt epic',
    'git worktree add ' + W(415),
    'run space.new',
    'setShared',
    'setShared'
  ])
  const [list, refs, cli, add, run] = log
  assert.deepEqual(list.args, ['-C', `${ROOT}/backend`, 'worktree', 'list', '--porcelain'])
  assert.deepEqual(refs.args, ['-C', ROOT, 'for-each-ref', 'refs/heads/epic-415'])
  assert.deepEqual(cli.args, [
    '-y', `conport@${CLI_VERSION}`, 'prompt', 'epic', '415', '-p', 'prk7m2qx9d', '--harness', 'claude', '--worktree', W(415),
    '--base', 'main', '--implementer', 'conport:sdd-implementer', '--reviewer', 'conport:sdd-task-reviewer',
    '--gap-hunter', 'conport:sdd-gap-hunter', '--final-reviewer', 'conport:sdd-final-reviewer', '--json'
  ])
  assert.deepEqual(cli.options, { cwd: ROOT, timeout: 300000 })
  assert.deepEqual(add.args, ['-C', ROOT, 'worktree', 'add', W(415), '-b', 'epic-415', 'main'])
  assert.deepEqual(add.options, { timeout: 600000 })
  assert.deepEqual(run.args, { name: 'epic-415', folder: W(415), tab: 'lead', argv: ['claude', LONG_TASK], machine: '' })
  assert.equal(run.args.argv.at(-1), LONG_TASK)
  assert.deepEqual(shared.get(epicKey(GIT_DIR, 415)), { harness: 'claude', roles: DEFAULT_ROLES })
  assert.equal(shared.get(harnessKey(GIT_DIR)), 'claude')
})

test('startEpic: a branch without a copy gets its copy from the branch', async () => {
  const { deps, log } = world({ worktrees: 'git-worktree-list.json', refs: 'git-for-each-ref-epic.json' })
  // The record lists a copy of epic 412: remove it from the list, the branch stays.
  deps.exec = ((exec) => async (command, args, options) => {
    const answer = await exec(command, args, options)
    if (args.includes('list')) return { ...answer, stdout: answer.stdout.split('\n\n').filter((block) => !block.includes('epic-412')).join('\n\n') }
    return answer
  })(deps.exec)
  const started = await startEpic(deps, input(412))
  assert.equal(started.data.copy, 'branch')
  const add = log.find((entry) => entry.args?.includes('add'))
  assert.deepEqual(add.args, ['-C', ROOT, 'worktree', 'add', W(412), 'epic-412'])
})

test('startEpic: the copy that is there is taken as it is, and a live session gets a new lead tab in its space', async () => {
  const { deps, log } = world({ refs: 'git-for-each-ref-epic.json', snap: 'claude-working.json' })
  const started = await startEpic(deps, input(412))
  assert.deepEqual(started.data, { worktree: W(412), base: 'main', copy: 'existing', command: 'tab.new', space: 'spedbe3f924f2f331e70b470d09ac8ba38' })
  assert.ok(!log.some((entry) => entry.args?.includes?.('add')))
  const run = log.find((entry) => entry.step === 'run')
  assert.deepEqual(run, {
    step: 'run',
    name: 'tab.new',
    args: { space: 'spedbe3f924f2f331e70b470d09ac8ba38', name: 'lead', folder: W(412), argv: ['claude', LONG_TASK] }
  })
})

test('startEpic: a copy whose agent quit gets the lead tab in the space of that copy', async () => {
  const worktrees = 'git-worktree-list.json'
  const { deps, log } = world({ worktrees, refs: 'git-for-each-ref-epic.json', snap: 'codex-exited.json' })
  deps.exec = ((exec) => async (command, args, options) => {
    const answer = await exec(command, args, options)
    return args.includes('list') ? { ...answer, stdout: answer.stdout.replaceAll('epic-412', 'epic-417') } : answer
  })(deps.exec)
  const started = await startEpic(deps, input(417, { harness: 'codex' }))
  assert.equal(started.data.command, 'tab.new')
  assert.equal(started.data.space, 'sp5fa94f3b9b98eb6f3dd782688e31b4b7')
  const run = log.find((entry) => entry.step === 'run')
  assert.deepEqual(run.args.argv, ['codex', '--no-daemon', LONG_TASK])
})

test('startEpic: a refusal of the CLI creates nothing: no branch, no copy, no space, nothing remembered', async () => {
  const refusal = { ok: false, error: { code: 'epic_not_ready', message: 'epic 415 cannot run: no plan', action: 'prepare it first' } }
  const { deps, log } = world({ cli: () => ({ code: 2, stdout: JSON.stringify(refusal), stderr: '' }) })
  const started = await startEpic(deps, input(415))
  assert.deepEqual(started, { ok: false, error: { code: 'epic_not_ready', fact: 'epic 415 cannot run: no plan', action: 'prepare it first' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain', 'git for-each-ref refs/heads/epic-415', 'npx prompt epic'])
})

test('startEpic: a CLI that does not answer in 300 s creates nothing', async () => {
  const { deps, log } = world({
    cli: () => {
      throw new Error('timed out')
    }
  })
  const started = await startEpic(deps, input(415))
  assert.equal(started.error.code, 'cli_timeout')
  assert.ok(!log.some((entry) => entry.step === 'run' || entry.args?.includes?.('add')))
})

test('startEpic: a harness not installed is refused before anything runs', async () => {
  const { deps, log } = world()
  const started = await startEpic(deps, input(415, { harness: 'cursor' }))
  assert.deepEqual(started, { ok: false, error: { code: 'harness_missing', fact: 'Cursor', action: '' } })
  assert.deepEqual(log, [])
})

test('startEpic: a detached root is refused before the CLI is asked', async () => {
  const detached = world({ worktrees: 'git-worktree-list-detached.json' })
  assert.equal((await startEpic(detached.deps, input(415))).error.code, 'root_detached')
  assert.ok(!detached.log.some((entry) => entry.command === 'npx'))
})

test('startEpic: a failed git worktree add is told with its text and the copy to remove; no space is opened', async () => {
  const { deps, log } = world({ add: () => ({ code: 128, stdout: '', stderr: "Preparing worktree\nfatal: could not create directory\n" }) })
  const started = await startEpic(deps, input(415))
  assert.deepEqual(started, {
    ok: false,
    error: { code: 'worktree_failed', fact: 'fatal: could not create directory', action: '', worktree: W(415) }
  })
  assert.ok(!log.some((entry) => entry.step === 'run' || entry.step === 'setShared'))

  const late = world({
    add: () => {
      throw new Error('timed out after 600000 ms')
    }
  })
  const slow = await startEpic(late.deps, input(415))
  assert.equal(slow.error.code, 'worktree_failed')
  assert.equal(slow.error.fact, 'git worktree add did not finish in 600 s')
})

test('startEpic: git that cannot list the copies is told as it said it', async () => {
  const { deps } = world()
  deps.exec = async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' })
  const started = await startEpic(deps, input(415))
  assert.equal(started.error.code, 'git_failed')
  assert.equal(started.error.fact, 'fatal: not a git repository (or any of the parent directories): .git')
})

test('startEpic: git rejecting is told by its own text, and only a late git worktree add by the 600 s line', async () => {
  const missing = world()
  missing.deps.exec = async () => {
    throw new Error('No such file or directory (os error 2)')
  }
  const gone = await startEpic(missing.deps, input(415))
  assert.deepEqual(gone.error, { code: 'git_failed', fact: 'No such file or directory (os error 2)', action: '' })

  const late = world()
  late.deps.exec = async () => {
    throw new Error('timed out after 30000 ms')
  }
  const slowList = await startEpic(late.deps, input(415))
  assert.deepEqual(slowList.error, { code: 'git_failed', fact: 'timed out after 30000 ms', action: '' })

  const broken = world({
    add: () => {
      throw new Error('could not spawn')
    }
  })
  const failed = await startEpic(broken.deps, input(415))
  assert.deepEqual(failed.error, { code: 'worktree_failed', fact: 'could not spawn', action: '', worktree: W(415) })
})

test('startEpic: git listing no checkout is refused before branches or the CLI are asked', async () => {
  const { deps, log } = world()
  deps.exec = async (command, args, options) => {
    log.push({ step: 'exec', command, args, options })
    return { code: 0, stdout: '', stderr: '' }
  }
  const started = await startEpic(deps, input(415))
  assert.equal(started.error.code, 'git_failed')
  assert.deepEqual(steps(log), ['git worktree list --porcelain'])
})

test('startEpic: an answer of the CLI without a text is bad_output, and nothing is created', async () => {
  const { deps, log } = world({ cli: () => ({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }) })
  assert.equal((await startEpic(deps, input(415))).error.code, 'bad_output')
  assert.ok(!log.some((entry) => entry.step === 'run' || entry.args?.includes?.('add')))
})

test('startEpic on a real repository with spaces and non-ASCII in its path makes the copy at <W> and opens it', async (t) => {
  const top = scratch(t)
  const home = join(top, 'σπίτι user')
  const root = repository(join(top, 'my repo ö'))
  const { execFileSync } = await import('node:child_process')
  const runs = []
  const deps = {
    exec: async (command, args, options) => {
      if (command === 'npx') return { code: 0, stdout: JSON.stringify({ ok: true, text: LONG_TASK }), stderr: '' }
      try {
        return { code: 0, stdout: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: options?.timeout }), stderr: '' }
      } catch (error) {
        return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
      }
    },
    run: (name, args) => {
      runs.push({ name, args })
      return null
    },
    setShared: () => null,
    home,
    spaces: () => [],
    panes: () => [],
    agents: () => []
  }
  const started = await startEpic(deps, input(3, { folder: root, gitDir: join(root, '.git') }))
  const worktree = join(home, '.herdr', 'worktrees', 'my repo ö', 'epic-3')
  assert.deepEqual(started.data, { worktree, base: 'main', copy: 'new', command: 'space.new', space: null })
  assert.equal(git(['branch', '--show-current'], worktree).trim(), 'epic-3')
  assert.deepEqual(runs, [{ name: 'space.new', args: { name: 'epic-3', folder: worktree, tab: 'lead', argv: ['claude', LONG_TASK], machine: '' } }])

  // Started again, the copy is there and is taken as it is.
  const again = await startEpic(deps, input(3, { folder: worktree, gitDir: join(root, '.git') }))
  assert.equal(again.data.copy, 'existing')
  assert.equal(again.data.worktree, worktree)
})

test('readPlace: where an epic runs, read by git from any folder of its repository', async () => {
  const { deps, log } = world({ refs: 'git-for-each-ref-epic.json' })
  const place = await readPlace(deps.exec, { folder: `${ROOT}/backend`, epic: 412, home: HOME })
  assert.deepEqual(place, { ok: true, data: { root: ROOT, base: 'main', worktree: W(412), copy: 'existing' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain', 'git for-each-ref refs/heads/epic-412'])
  // It only reads: nothing is added, opened or remembered.
  assert.ok(!log.some((entry) => entry.step !== 'exec'))

  const fresh = await readPlace(world().deps.exec, { folder: ROOT, epic: 415, home: HOME })
  assert.deepEqual(fresh.data, { root: ROOT, base: 'main', worktree: W(415), copy: 'new' })
})

test('projectSpaceArgs: a new space in the root of the project, the tab named, the task last, on this machine', () => {
  assert.deepEqual(projectSpaceArgs({ root: ROOT, name: 'idea-9', run: ['codex', '--no-daemon'], text: LONG_TASK }), {
    folder: ROOT,
    tab: 'idea-9',
    argv: ['codex', '--no-daemon', LONG_TASK],
    machine: ''
  })
})

const hand = (kind, id, extra = {}) => ({
  kind,
  id,
  agent: 'claude',
  project: 'prk7m2qx9d',
  root: ROOT,
  gitDir: GIT_DIR,
  knownAgents: record('known-agents.json'),
  ...extra
})

const NESTED = `${ROOT}/.claude/worktrees/side`

/**
 * The world of handToAgent: the snapshot with the pane of `notes` standing in the root when
 * `inRoot`; with `nested`, git also lists a copy inside the root, and the pane of epic-412 stands
 * in it, listed before every other pane.
 */
function handWorld({ inRoot = false, nested = false, cli } = {}) {
  const w = world({ cli })
  const live = record('claude-working.json')
  let panes = live.panes
  if (inRoot) panes = panes.map((pane) => (pane.cwd === `${HOME}/notes` ? { ...pane, cwd: ROOT } : pane))
  if (nested) {
    panes = panes.map((pane) => (pane.cwd === W(412) ? { ...pane, cwd: `${NESTED}/backend` } : pane)).reverse()
    w.deps.exec = ((exec) => async (command, args, options) => {
      const answer = await exec(command, args, options)
      if (!args.includes('list')) return answer
      return { ...answer, stdout: `${answer.stdout.trimEnd()}\n\nworktree ${NESTED}\nHEAD 0123456789abcdef0123456789abcdef01234567\nbranch refs/heads/side\n` }
    })(w.deps.exec)
  }
  w.deps.panes = () => panes
  return w
}

test('handToAgent: a task gets its task from the CLI, then a tab task-<id> in the space of the project', async () => {
  const { deps, log, shared } = handWorld({ inRoot: true })
  const handed = await handToAgent(deps, hand('review', 31))
  assert.deepEqual(handed, { ok: true, data: { name: 'task-31', command: 'tab.new', space: 'sp181d9986e6b719db33e8a6e91303098d' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain', 'npx prompt task', 'run tab.new', 'setShared'])
  const [list, cli, run] = log
  assert.deepEqual(list.args, ['-C', ROOT, 'worktree', 'list', '--porcelain'])
  assert.deepEqual(cli.args, [
    '-y', `conport@${CLI_VERSION}`, 'prompt', 'task', '31', '-p', 'prk7m2qx9d', '--host', 'herdr', '--mode', 'review', '--agent', 'claude', '--root', ROOT, '--json'
  ])
  assert.deepEqual(cli.options, { cwd: ROOT, timeout: 300000 })
  assert.deepEqual(run.args, { space: 'sp181d9986e6b719db33e8a6e91303098d', name: 'task-31', folder: ROOT, argv: ['claude', LONG_TASK] })
  assert.equal(shared.get(agentKey(GIT_DIR)), 'claude')
})

test('handToAgent: a task in each mode, a new space in the root when no space stands there', async () => {
  for (const mode of ['do', 'review', 'fix']) {
    const { deps, log, shared } = handWorld()
    const handed = await handToAgent(deps, hand(mode, 31, { agent: 'codex' }))
    assert.deepEqual(handed, { ok: true, data: { name: 'task-31', command: 'space.new', space: null } }, mode)
    const [, cli, run] = log
    assert.deepEqual(cli.args.slice(2), ['prompt', 'task', '31', '-p', 'prk7m2qx9d', '--host', 'herdr', '--mode', mode, '--agent', 'codex', '--root', ROOT, '--json'])
    assert.deepEqual(run, { step: 'run', name: 'space.new', args: { folder: ROOT, tab: 'task-31', argv: ['codex', '--no-daemon', LONG_TASK], machine: '' } })
    assert.equal(shared.get(agentKey(GIT_DIR)), 'codex')
  }
})

test('handToAgent: an agent not installed and a refusal of the CLI open nothing and remember nothing', async () => {
  const missing = handWorld()
  assert.deepEqual(await handToAgent(missing.deps, hand('do', 31, { agent: 'cursor' })), {
    ok: false,
    error: { code: 'harness_missing', fact: 'Cursor', action: '' }
  })
  assert.deepEqual(missing.log, [])

  const refusal = { ok: false, error: { code: 'task_moved', message: 'task 31 is in review', action: 'refresh' } }
  const moved = handWorld({ cli: () => ({ code: 2, stdout: JSON.stringify(refusal), stderr: '' }) })
  const handed = await handToAgent(moved.deps, hand('do', 31))
  assert.deepEqual(handed, { ok: false, error: { code: 'task_moved', fact: 'task 31 is in review', action: 'refresh' } })
  assert.deepEqual(steps(moved.log), ['git worktree list --porcelain', 'npx prompt task'])

  const empty = handWorld({ cli: () => ({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }) })
  assert.equal((await handToAgent(empty.deps, hand('review', 31))).error.code, 'bad_output')
  assert.deepEqual(steps(empty.log), ['git worktree list --porcelain', 'npx prompt task'])
})

test('handToAgent: a pane in a copy nested in the root is not the space of the project', async () => {
  // The pane of the nested copy comes first; the pane of the root after it: the root's space is taken.
  const both = handWorld({ inRoot: true, nested: true })
  assert.equal(both.deps.panes()[0].cwd, `${NESTED}/backend`)
  const handed = await handToAgent(both.deps, hand('fix', 9))
  assert.deepEqual(handed.data, { name: 'task-9', command: 'tab.new', space: 'sp181d9986e6b719db33e8a6e91303098d' })

  // Only the nested copy has a pane: no space of the project, a new one in the root.
  const only = handWorld({ nested: true })
  const alone = await handToAgent(only.deps, hand('do', 31))
  assert.deepEqual(alone.data, { name: 'task-31', command: 'space.new', space: null })
  assert.equal(only.log.find((entry) => entry.step === 'run').args.folder, ROOT)
})

test('handToAgent: git that cannot list the copies is refused before the CLI is asked', async () => {
  const { deps, log } = handWorld()
  deps.exec = async (command, args, options) => {
    log.push({ step: 'exec', command, args, options })
    return { code: 128, stdout: '', stderr: 'fatal: not a git repository\n' }
  }
  assert.deepEqual(await handToAgent(deps, hand('do', 31)), { ok: false, error: { code: 'git_failed', fact: 'fatal: not a git repository', action: '' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain'])
})

const launch = (extra = {}) => ({
  agent: 'claude',
  project: 'prk7m2qx9d',
  root: ROOT,
  gitDir: GIT_DIR,
  knownAgents: record('known-agents.json'),
  ...extra
})

test('startIdea opens tab idea-<id> with the CLI task', async () => {
  const { deps, log, shared } = handWorld({ inRoot: true })
  const started = await startIdea(deps, launch({ task: 2116 }))
  assert.deepEqual(started, { ok: true, data: { name: 'idea-2116', command: 'tab.new', space: 'sp181d9986e6b719db33e8a6e91303098d' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain', 'npx prompt idea', 'run tab.new', 'setShared'])
  const [, cli, run] = log
  assert.deepEqual(cli.args, [
    '-y', `conport@${CLI_VERSION}`, 'prompt', 'idea', '2116', '-p', 'prk7m2qx9d', '--host', 'herdr', '--agent', 'claude', '--root', ROOT, '--json'
  ])
  assert.deepEqual(cli.options, { cwd: ROOT, timeout: 300000 })
  assert.deepEqual(run.args, { space: 'sp181d9986e6b719db33e8a6e91303098d', name: 'idea-2116', folder: ROOT, argv: ['claude', LONG_TASK] })
  assert.equal(shared.get(agentKey(GIT_DIR)), 'claude')

  // No space stands in the root: a new space there, the tab idea-<id>.
  const alone = handWorld()
  const fresh = await startIdea(alone.deps, launch({ task: 2116, agent: 'codex' }))
  assert.deepEqual(fresh.data, { name: 'idea-2116', command: 'space.new', space: null })
  assert.deepEqual(alone.log.find((entry) => entry.step === 'run').args, {
    folder: ROOT,
    tab: 'idea-2116',
    argv: ['codex', '--no-daemon', LONG_TASK],
    machine: ''
  })
})

test('startIdea: an agent not installed, a refusal of the CLI and an answer without a task open nothing', async () => {
  const missing = handWorld()
  assert.equal((await startIdea(missing.deps, launch({ task: 2116, agent: 'cursor' }))).error.code, 'harness_missing')
  assert.deepEqual(missing.log, [])

  const refusal = { ok: false, error: { code: 'idea_taken', message: 'task 2116 is in review', action: 'press Refresh' } }
  const taken = handWorld({ cli: () => ({ code: 2, stdout: JSON.stringify(refusal), stderr: '' }) })
  assert.deepEqual(await startIdea(taken.deps, launch({ task: 2116 })), {
    ok: false,
    error: { code: 'idea_taken', fact: 'task 2116 is in review', action: 'press Refresh' }
  })
  assert.deepEqual(steps(taken.log), ['git worktree list --porcelain', 'npx prompt idea'])

  const empty = handWorld({ cli: () => ({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }) })
  assert.equal((await startIdea(empty.deps, launch({ task: 2116 }))).error.code, 'bad_output')
  assert.deepEqual(steps(empty.log), ['git worktree list --porcelain', 'npx prompt idea'])
})

/** The world of handToAgent with the main checkout on `branch`, or detached for null. */
function mainOn(branch) {
  const w = handWorld({ inRoot: true })
  w.deps.exec = ((exec) => async (command, args, options) => {
    const answer = await exec(command, args, options)
    if (command === 'npx' || !args.includes('list')) return answer
    const main = branch === null ? 'detached' : `branch refs/heads/${branch}`
    return { ...answer, stdout: answer.stdout.replace('branch refs/heads/main', main) }
  })(w.deps.exec)
  return w
}

test('startSpec passes the base of the main checkout', async () => {
  const doc = mainOn('trunk')
  const planned = await startSpec(doc.deps, launch({ target: { doc: 245 } }))
  assert.deepEqual(planned, { ok: true, data: { name: docRef(245), command: 'tab.new', space: 'sp181d9986e6b719db33e8a6e91303098d' } })
  assert.deepEqual(steps(doc.log), ['git worktree list --porcelain', 'npx prompt spec', 'run tab.new', 'setShared'])
  const [list, cli, run] = doc.log
  assert.deepEqual(list.args, ['-C', ROOT, 'worktree', 'list', '--porcelain'])
  assert.deepEqual(cli.args.slice(2), [
    'prompt', 'spec', docRef(245), '-p', 'prk7m2qx9d', '--host', 'herdr', '--agent', 'claude', '--root', ROOT, '--base', 'trunk', '--json'
  ])
  assert.deepEqual(run.args, { space: 'sp181d9986e6b719db33e8a6e91303098d', name: docRef(245), folder: ROOT, argv: ['claude', LONG_TASK] })
  assert.equal(doc.shared.get(agentKey(GIT_DIR)), 'claude')

  // An epic with a spec and no plan: the tab plan-<epic>, the epic named task-<N>.
  const epic = mainOn('main')
  const built = await startSpec(epic.deps, launch({ target: { epic: 1597 }, agent: 'codex' }))
  assert.deepEqual(built.data, { name: 'plan-1597', command: 'tab.new', space: 'sp181d9986e6b719db33e8a6e91303098d' })
  assert.deepEqual(epic.log[1].args.slice(2), [
    'prompt', 'spec', 'task-1597', '-p', 'prk7m2qx9d', '--host', 'herdr', '--agent', 'codex', '--root', ROOT, '--base', 'main', '--json'
  ])
})

test('startSpec: a detached main checkout has no base and is refused before the CLI is asked', async () => {
  const { deps, log } = mainOn(null)
  const refused = await startSpec(deps, launch({ target: { doc: 245 } }))
  assert.equal(refused.error.code, 'root_detached')
  assert.deepEqual(steps(log), ['git worktree list --porcelain'])
})

test('startSpec: git listing no checkout is git_failed, refused before the CLI is asked', async () => {
  const { deps, log } = handWorld()
  deps.exec = async (command, args, options) => {
    log.push({ step: 'exec', command, args, options })
    return { code: 0, stdout: '', stderr: '' }
  }
  const refused = await startSpec(deps, launch({ target: { doc: 245 } }))
  assert.deepEqual(refused, { ok: false, error: { code: 'git_failed', fact: 'git listed no checkout of the repository', action: '' } })
  assert.deepEqual(steps(log), ['git worktree list --porcelain'])
})

test('startSpec: a refusal of the CLI opens nothing and remembers nothing', async () => {
  const refusal = { ok: false, error: { code: 'spec_planned', message: `${docRef(245)} has its plan`, action: 'press Refresh; the epic is In work' } }
  const { deps, log } = handWorld({ cli: () => ({ code: 2, stdout: JSON.stringify(refusal), stderr: '' }) })
  const refused = await startSpec(deps, launch({ target: { doc: 245 } }))
  assert.equal(refused.error.code, 'spec_planned')
  assert.deepEqual(steps(log), ['git worktree list --porcelain', 'npx prompt spec'])
})

/** An exec of the CLI alone that answers `answer` and logs each call. */
function cliOnly(answer) {
  const calls = []
  const exec = async (command, args, options) => {
    calls.push({ command, args, options })
    return answer(args)
  }
  return { exec, calls }
}

test('acceptProposal answers the task; a refusal opens nothing', async () => {
  const runs = []
  const run = (name) => runs.push(name)
  const accepted = cliOnly(() => ({ code: 0, stdout: JSON.stringify({ task: 2301 }), stderr: '' }))
  assert.deepEqual(await acceptProposal({ exec: accepted.exec, run }, { doc: 301, project: 'prk7m2qx9d', root: ROOT }), { ok: true, data: { task: 2301 } })
  assert.deepEqual(accepted.calls, [
    { command: 'npx', args: ['-y', `conport@${CLI_VERSION}`, 'proposal', 'accept', docRef(301), '-p', 'prk7m2qx9d', '--json'], options: { cwd: ROOT, timeout: 300000 } }
  ])

  const body = { ok: false, error: { code: 'proposal_closed', message: `proposal ${docRef(301)} is declined`, action: 'refresh the list' } }
  const closed = cliOnly(() => ({ code: 2, stdout: JSON.stringify(body), stderr: '' }))
  assert.deepEqual(await acceptProposal({ exec: closed.exec, run }, { doc: 301, project: 'prk7m2qx9d', root: ROOT }), {
    ok: false,
    error: { code: 'proposal_closed', fact: `proposal ${docRef(301)} is declined`, action: 'refresh the list' }
  })

  // An answer without a task number is bad_output.
  for (const answer of [{}, { task: 'task-2301' }, { task: 0 }]) {
    const odd = cliOnly(() => ({ code: 0, stdout: JSON.stringify(answer), stderr: '' }))
    assert.equal((await acceptProposal({ exec: odd.exec, run }, { doc: 301, project: 'p', root: ROOT })).error.code, 'bad_output', JSON.stringify(answer))
  }
  assert.deepEqual(runs, [])
})

test('declineProposal without a reason is reason_missing', async () => {
  for (const reason of ['', '   ', undefined]) {
    const { exec, calls } = cliOnly(() => ({ code: 0, stdout: '{}', stderr: '' }))
    assert.deepEqual(await declineProposal({ exec }, { doc: 301, project: 'p', root: ROOT, reason }), {
      ok: false,
      error: { code: 'reason_missing', fact: '', action: '' }
    })
    assert.deepEqual(calls, [])
  }
})

test('declineProposal passes the reason to the CLI and answers nothing more', async () => {
  const { exec, calls } = cliOnly(() => ({ code: 0, stdout: JSON.stringify({ doc: 301, state: 'declined' }), stderr: '' }))
  assert.deepEqual(await declineProposal({ exec }, { doc: 301, project: 'p', root: ROOT, reason: ' Not ours. ' }), { ok: true, data: null })
  assert.deepEqual(calls[0].args.slice(2), ['proposal', 'decline', docRef(301), '-p', 'p', '--reason', 'Not ours.', '--json'])
  assert.deepEqual(calls[0].options, { cwd: ROOT, timeout: 300000 })

  const body = { ok: false, error: { code: 'not_a_proposal', message: `${docRef(301)} is not a proposal`, action: 'name a proposal' } }
  const refused = cliOnly(() => ({ code: 2, stdout: JSON.stringify(body), stderr: '' }))
  assert.equal((await declineProposal({ exec: refused.exec }, { doc: 301, project: 'p', root: ROOT, reason: 'x' })).error.code, 'not_a_proposal')
})
