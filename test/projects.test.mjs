import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { gitDirArgs } from '../mods/conport/git.js'
import {
  bindingParts,
  gitDirOf,
  mainRootOf,
  mergeProjects,
  NO_GIT,
  NO_MAIN_CHECKOUT_NOTE,
  NO_SETTINGS_NOTE,
  pickProject,
  projectBinding,
  readBindingTexts,
  readConfigHome,
  readErrorCode,
  SETTINGS_GIT_TIMEOUT_MS,
  settleGitDir,
  spaceFolders
} from '../mods/conport/projects.js'
import { git, HOME, record, repository, scratch } from './records.mjs'

test('spaceFolders lists the live folders of the panes of each space of this machine', () => {
  const snap = record('codex-exited.json')
  assert.deepEqual(spaceFolders(snap.spaces, snap.panes), [
    { id: 'sp181d9986e6b719db33e8a6e91303098d', name: 'notes', folders: [`${HOME}/notes`] },
    { id: 'sp25864106b0fa993855ef16228e111c69', name: 'epic-416', folders: [`${HOME}/.herdr/worktrees/acme-app/epic-416`] },
    { id: 'sp5fa94f3b9b98eb6f3dd782688e31b4b7', name: 'epic-417', folders: [`${HOME}/.herdr/worktrees/acme-app/epic-417`] }
  ])
})

test('spaceFolders leaves out the spaces of another machine', () => {
  const snap = record('codex-exited.json')
  const spaces = snap.spaces.map((space) => (space.name === 'notes' ? { ...space, machine: 'vps' } : space))
  assert.deepEqual(spaceFolders(spaces, snap.panes).map((space) => space.name), ['epic-416', 'epic-417'])
})

test('spaceFolders takes the folder of a space whose panes name none', () => {
  const snap = record('codex-exited.json')
  const panes = snap.panes.map((pane) => ({ ...pane, cwd: null }))
  assert.deepEqual(spaceFolders(snap.spaces, panes)[0].folders, [HOME])
})

test('the recorded root and checkout of one repository merge into one project by the git directory', () => {
  const { from_root: root, from_worktree: copy } = record('git-common-dir.json')
  const spaces = [
    { id: 'a', name: 'acme', folders: [`${HOME}/src/acme-app`] },
    { id: 'b', name: 'epic-413', folders: [copy.folder] }
  ]
  const gitDirs = { [`${HOME}/src/acme-app`]: root.stdout.trim(), [copy.folder]: copy.stdout.trim() }
  assert.deepEqual(mergeProjects(spaces, gitDirs), {
    projects: [
      {
        gitDir: `${HOME}/src/acme-app/.git`,
        root: `${HOME}/src/acme-app`,
        name: 'acme-app',
        spaces: ['a', 'b'],
        folders: [`${HOME}/src/acme-app`, copy.folder]
      }
    ],
    plain: []
  })
})

test('on real repositories, checkouts under ~/.herdr/worktrees and elsewhere merge, and a folder without git is set apart', (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'έργο app'))
  const other = repository(join(top, 'other'))
  const copy = join(top, 'home', '.herdr', 'worktrees', 'έργο app', 'epic-3')
  git(['worktree', 'add', '-q', copy, '-b', 'epic-3', 'main'], root)
  const deep = join(root, 'backend')
  mkdirSync(deep)
  const plainFolder = join(top, 'notes')
  mkdirSync(plainFolder)

  const spaces = [
    { id: 's1', name: 'main', folders: [deep] },
    { id: 's2', name: 'notes', folders: [plainFolder] },
    { id: 's3', name: 'epic-3', folders: [copy] },
    { id: 's4', name: 'other', folders: [other] }
  ]
  const gitDirs = {}
  for (const folder of [deep, copy, other]) gitDirs[folder] = git(gitDirArgs(folder)).trim()
  gitDirs[plainFolder] = null

  const { projects, plain } = mergeProjects(spaces, gitDirs)
  assert.deepEqual(
    projects.map(({ name, root: r, spaces: s }) => ({ name, root: r, spaces: s })),
    [
      { name: 'έργο app', root, spaces: ['s1', 's3'] },
      { name: 'other', root: other, spaces: ['s4'] }
    ]
  )
  assert.deepEqual(plain, [{ folder: plainFolder, spaces: ['s2'], reason: NO_GIT }])
  assert.equal(NO_GIT, 'Folder without git — nothing to run')
})

test('pickProject: the project of the focused space first, else the last chosen, else the first', () => {
  const projects = [
    { gitDir: '/a/.git', spaces: ['s1'] },
    { gitDir: '/b/.git', spaces: ['s2', 's3'] }
  ]
  assert.equal(pickProject(projects, { focusedSpace: 's3', last: '/a/.git' }), '/b/.git')
  assert.equal(pickProject(projects, { focusedSpace: 'nope', last: '/a/.git' }), '/a/.git')
  assert.equal(pickProject(projects, { focusedSpace: null, last: '/gone/.git' }), '/a/.git')
  assert.equal(pickProject([], { focusedSpace: null, last: null }), null)
})

/** The texts of a repository with nothing in them, `patch` over it. */
const texts = (patch = {}) => ({ shared: null, local: null, localIgnored: null, legacy: null, userEnv: null, ...patch })
const legacy = (/** @type {unknown} */ name) => JSON.stringify({ env: { CONPORT_PROJECT_NAME: name }, permissions: {} })

test('the binding comes from .conport.json', () => {
  const shared = '{\n  "$schema": "https://conport.app/schema/conport.json",\n  "project_name": " prk7m2qx9d "\n}\n'
  assert.deepEqual(projectBinding(texts({ shared }), 'acme'), { project: 'prk7m2qx9d', source: 'file', lines: [], blocked: false, mainCheckout: true })
  // The old place is no variable: naming the same project or another, the file wins and
  // nothing is said of it — as in the Orca plugin, which reads it after the rules too.
  assert.deepEqual(projectBinding(texts({ shared, legacy: legacy('prk7m2qx9d') }), 'acme'), {
    project: 'prk7m2qx9d', source: 'file', lines: [], blocked: false, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts({ shared, legacy: legacy('acme-app') }), 'acme'), {
    project: 'prk7m2qx9d', source: 'file', lines: [], blocked: false, mainCheckout: true
  })
})

test('the local file overrides it', () => {
  const shared = JSON.stringify({ project_name: 'prk7m2qx9d' })
  const local = JSON.stringify({ project_name: 'pers/sandbox' })
  assert.deepEqual(projectBinding(texts({ shared, local, localIgnored: true }), 'acme'), {
    project: 'pers/sandbox',
    source: 'file',
    lines: ['project_name from .conport.local.json (pers/sandbox) overrides .conport.json (prk7m2qx9d)'],
    blocked: false, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts({ local, localIgnored: false }), null), {
    project: 'pers/sandbox',
    source: 'file',
    lines: ['.conport.local.json is not ignored by git: add it to .gitignore'],
    blocked: false, mainCheckout: true
  })
})

test('the old settings place comes second', () => {
  const noName = JSON.stringify({ plugins: { superpowers: true } })
  assert.deepEqual(projectBinding(texts({ legacy: legacy(' acme-app ') }), 'prk7m2qx9d'), {
    project: 'acme-app', source: 'repository', lines: [], blocked: false, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts({ shared: noName, legacy: legacy('acme-app') }), 'prk7m2qx9d'), {
    project: 'acme-app', source: 'repository', lines: [], blocked: false, mainCheckout: true
  })
})

test('the stored binding comes last', () => {
  assert.deepEqual(projectBinding(texts({ legacy: JSON.stringify({ env: {} }) }), 'prk7m2qx9d'), {
    project: 'prk7m2qx9d', source: 'stored', lines: [], blocked: false, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts(), ' acme '), { project: 'acme', source: 'stored', lines: [], blocked: false, mainCheckout: true })
  assert.deepEqual(projectBinding(texts({ legacy: '{ not json' }), 'acme'), { project: 'acme', source: 'stored', lines: [], blocked: false, mainCheckout: true })
  assert.deepEqual(projectBinding(texts({ legacy: legacy('') }), 'acme'), { project: 'acme', source: 'stored', lines: [], blocked: false, mainCheckout: true })
  assert.deepEqual(projectBinding(texts({ legacy: legacy(42) }), 'acme'), { project: 'acme', source: 'stored', lines: [], blocked: false, mainCheckout: true })
  for (const stored of [undefined, null, '  ', 42]) {
    assert.deepEqual(projectBinding(texts(), stored), { project: null, source: null, lines: [], blocked: false, mainCheckout: true })
  }
})

test('settings lines travel with the binding', () => {
  // A broken file names no project: neither the old place nor the kept binding stands in.
  assert.deepEqual(projectBinding(texts({ shared: '{\n  "project_name": "x",\n}', legacy: legacy('acme-app') }), 'acme'), {
    project: null,
    source: null,
    lines: ['.conport.json is not valid JSON (line 3, column 1): fix it'],
    blocked: true, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts({ shared: { error: 'EISDIR' } }), 'acme'), {
    project: null,
    source: null,
    lines: ['.conport.json cannot be read (EISDIR): fix it'],
    blocked: true, mainCheckout: true
  })
  assert.deepEqual(projectBinding(texts({ shared: JSON.stringify({ project_name: '  ' }) }), 'acme'), {
    project: null,
    source: null,
    lines: ['.conport.json: project_name must be a non-empty string — fix it'],
    blocked: true, mainCheckout: true
  })
  // A line that does not block rides along with whichever source named the project.
  assert.deepEqual(projectBinding(texts({ userEnv: 'CONPORT_API_KEY=x\nCONPORT_PROJECT_NAME=acme\n' }), 'acme'), {
    project: 'acme',
    source: 'stored',
    lines: ['CONPORT_PROJECT_NAME in ~/.config/conport/.env is not read: it would apply to every repository — remove it'],
    blocked: false, mainCheckout: true
  })
})

test('the main checkout of a submodule or a bare repository has no settings files', () => {
  assert.equal(mainRootOf('/work/acme/.git'), '/work/acme')
  assert.equal(mainRootOf('/work/acme/.git/'), '/work/acme')
  assert.equal(mainRootOf('/work/acme/.git/modules/lib'), null)
  assert.equal(mainRootOf('/work/acme.git'), null)
})

const READS = record('read-text-file.json')

/**
 * Herdr's `readTextFile` over the real disk, as recorded: null when the file is absent, a
 * rejection with the host's own text for a folder or a file without permission.
 */
const readText = async (/** @type {string} */ path) => {
  if (!existsSync(path)) return null
  if (statSync(path).isDirectory()) throw new Error(READS['readTextFile(<a folder>)'].rejected)
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'EACCES') throw new Error(READS['readTextFile(<a file with mode 000>)'].rejected)
    throw error
  }
}

/** Herdr's `exec` over the real git, recording the calls and their options. */
const execRecorder = () => {
  /** @type {string[][]} */
  const calls = []
  /** @type {unknown[]} */
  const options = []
  const exec = async (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {unknown} */ opts) => {
    calls.push(args)
    options.push(opts)
    const answer = spawnSync(command, args, { encoding: 'utf8' })
    return { code: answer.status ?? -1, stdout: answer.stdout, stderr: answer.stderr }
  }
  return { exec, calls, options }
}

test('the settings files are read from the main checkout, the personal one asked of git only when it is there', async (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'acme'))
  const home = join(top, 'home')
  mkdirSync(join(home, '.config', 'conport'), { recursive: true })
  writeFileSync(join(home, '.config', 'conport', '.env'), 'CONPORT_PROJECT_NAME=acme\n')
  writeFileSync(join(root, '.conport.json'), JSON.stringify({ project_name: 'prk7m2qx9d' }))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude', 'settings.local.json'), legacy('acme-app'))
  const gitDir = git(gitDirArgs(root)).trim()

  const first = execRecorder()
  assert.deepEqual(await readBindingTexts({ read: readText, exec: first.exec, gitDir, home }), {
    shared: JSON.stringify({ project_name: 'prk7m2qx9d' }),
    local: null,
    localIgnored: null,
    legacy: legacy('acme-app'),
    userEnv: 'CONPORT_PROJECT_NAME=acme\n',
    mainCheckout: true
  })
  assert.deepEqual(first.calls, [])

  writeFileSync(join(root, '.conport.local.json'), JSON.stringify({ project_name: 'pers/sandbox' }))
  const second = execRecorder()
  assert.equal((await readBindingTexts({ read: readText, exec: second.exec, gitDir, home })).localIgnored, false)
  assert.deepEqual(second.calls, [
    ['-C', root, 'ls-files', '--error-unmatch', '--', '.conport.local.json'],
    ['-C', root, 'check-ignore', '-q', '--', '.conport.local.json']
  ])
  // Each git call is bounded as the conport plugin bounds its own.
  assert.equal(SETTINGS_GIT_TIMEOUT_MS, 5000)
  assert.deepEqual(second.options, [{ timeout: 5000 }, { timeout: 5000 }])

  writeFileSync(join(root, '.gitignore'), '.conport.local.json\n')
  assert.equal((await readBindingTexts({ read: readText, exec: execRecorder().exec, gitDir, home })).localIgnored, true)

  git(['add', '-f', '.conport.local.json'], root)
  assert.equal((await readBindingTexts({ read: readText, exec: execRecorder().exec, gitDir, home })).localIgnored, false)
})

test('~/.config/conport/.env is looked for under XDG_CONFIG_HOME when it is set', async (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'acme'))
  const gitDir = git(gitDirArgs(root)).trim()
  const home = join(top, 'home')
  const xdg = join(top, 'xdg')
  mkdirSync(join(home, '.config', 'conport'), { recursive: true })
  mkdirSync(join(xdg, 'conport'), { recursive: true })
  writeFileSync(join(home, '.config', 'conport', '.env'), 'CONPORT_PROJECT_NAME=home\n')
  writeFileSync(join(xdg, 'conport', '.env'), 'CONPORT_PROJECT_NAME=xdg\n')
  const read = (/** @type {string | null} */ configHome) =>
    readBindingTexts({ read: readText, exec: execRecorder().exec, gitDir, home, configHome })
  assert.equal((await read(xdg)).userEnv, 'CONPORT_PROJECT_NAME=xdg\n')
  assert.equal((await read(`${xdg}/`)).userEnv, 'CONPORT_PROJECT_NAME=xdg\n')
  assert.equal((await read(null)).userEnv, 'CONPORT_PROJECT_NAME=home\n')
  assert.equal((await read('')).userEnv, 'CONPORT_PROJECT_NAME=home\n')
})

test("XDG_CONFIG_HOME is asked of the person's environment through exec", async () => {
  /** Herdr's `exec` with the person's environment `env`, recording the calls. */
  const withEnv = (/** @type {Record<string, string | undefined>} */ env) => {
    const calls = []
    const exec = async (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {unknown} */ options) => {
      calls.push([command, args, options])
      const answer = spawnSync(command, args, { encoding: 'utf8', env })
      return { code: answer.status ?? -1, stdout: answer.stdout, stderr: answer.stderr }
    }
    return { exec, calls }
  }
  const { PATH } = process.env
  const set = withEnv({ PATH, XDG_CONFIG_HOME: '/work/t/xdg conf' })
  assert.equal(await readConfigHome(set.exec), '/work/t/xdg conf')
  assert.deepEqual(set.calls, [['printenv', ['XDG_CONFIG_HOME'], { timeout: 5000 }]])
  assert.equal(await readConfigHome(withEnv({ PATH }).exec), null)
  assert.equal(await readConfigHome(withEnv({ PATH, XDG_CONFIG_HOME: '' }).exec), null)
  assert.equal(await readConfigHome(async () => { throw new Error('No such file or directory (os error 2)') }), null)
})

test('the error code of a file Herdr could not read comes from its os error', () => {
  assert.equal(readErrorCode(new Error(READS['readTextFile(<a folder>)'].rejected)), 'EISDIR')
  assert.equal(readErrorCode(new Error(READS['readTextFile(<a file with mode 000>)'].rejected)), 'EACCES')
  assert.equal(readErrorCode(new Error('`herdr.readTextFile`: No such file or directory (os error 2)')), 'ENOENT')
  assert.equal(readErrorCode(new Error('`herdr.readTextFile`: Not a directory (os error 20)')), 'ENOTDIR')
  assert.equal(readErrorCode(new Error('`herdr.readTextFile`: Input/output error (os error 5)')), 'EIO')
  assert.equal(readErrorCode(new Error('`herdr.readTextFile`: file is larger than 1 MiB')), 'EIO')
  assert.equal(readErrorCode('Permission denied (os error 13)'), 'EACCES')
})

test('an unreadable .conport.json is a line, not a crash, and a submodule reads no settings', async (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'acme'))
  const gitDir = git(gitDirArgs(root)).trim()
  const home = join(top, 'home')
  mkdirSync(join(root, '.conport.json'))

  const found = await readBindingTexts({ read: readText, exec: execRecorder().exec, gitDir, home })
  assert.deepEqual(found.shared, { error: 'EISDIR' })
  assert.deepEqual(projectBinding(found, 'acme'), {
    project: null,
    source: null,
    lines: ['.conport.json cannot be read (EISDIR): fix it'],
    blocked: true,
    mainCheckout: true
  })

  // Root reads a file whatever its mode: the part without permission needs another user.
  if (process.getuid?.() !== 0) {
    const locked = join(root, '.conport.local.json')
    writeFileSync(locked, JSON.stringify({ project_name: 'pers/sandbox' }))
    // The scratch folder stays writable, so the file without permission goes with it.
    chmodSync(locked, 0o000)
    const both = await readBindingTexts({ read: readText, exec: execRecorder().exec, gitDir, home })
    assert.deepEqual(both.local, { error: 'EACCES' })
    assert.deepEqual(projectBinding(both, 'acme').lines, [
      '.conport.json cannot be read (EISDIR): fix it',
      '.conport.local.json cannot be read (EACCES): fix it',
      '.conport.local.json is not ignored by git: add it to .gitignore'
    ])
  }

  const asked = []
  const submodule = await readBindingTexts({
    read: async (/** @type {string} */ path) => {
      asked.push(path)
      return null
    },
    exec: execRecorder().exec,
    gitDir: `${root}/.git/modules/lib`,
    home
  })
  assert.deepEqual(submodule, { shared: null, local: null, localIgnored: null, legacy: null, userEnv: null, mainCheckout: false })
  assert.deepEqual(asked, [join(home, '.config', 'conport', '.env')])
})

test('a settings file behind a path through a file counts as absent, as one that is not there', async (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'acme'))
  const gitDir = git(gitDirArgs(root)).trim()
  const { exec, calls } = execRecorder()
  const read = async (/** @type {string} */ path) => {
    if (path.endsWith('/.conport.json')) throw new Error('`herdr.readTextFile`: Not a directory (os error 20)')
    if (path.endsWith('/.conport.local.json')) throw new Error('`herdr.readTextFile`: No such file or directory (os error 2)')
    return null
  }
  const found = await readBindingTexts({ read, exec, gitDir, home: join(top, 'home') })
  assert.equal(found.shared, null)
  assert.equal(found.local, null)
  assert.deepEqual(calls, [])
  assert.deepEqual(projectBinding({ ...found, legacy: JSON.stringify({ env: { CONPORT_PROJECT_NAME: 'acme-app' } }) }, 'acme'), {
    project: 'acme-app',
    source: 'repository',
    lines: [],
    blocked: false,
    mainCheckout: true
  })
})

test('a git failure other than "not a git repository" names no project and says why', () => {
  assert.equal(gitDirOf({ code: 0, stdout: '/work/acme/.git\n', stderr: '' }), '/work/acme/.git')
  assert.equal(gitDirOf({ code: 0, stdout: '\n', stderr: '' }), null)
  assert.equal(gitDirOf({ code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }), null)
  const dubious = gitDirOf({
    code: 128,
    stdout: '',
    stderr: "fatal: detected dubious ownership in repository at '/work/acme'\nTo add an exception for this directory, call:\n"
  })
  assert.deepEqual(dubious, {
    failed: "git failed (fatal: detected dubious ownership in repository at '/work/acme'): ConPort settings were not read"
  })
  assert.deepEqual(gitDirOf({ code: -1, stderr: 'No such file or directory (os error 2)' }), {
    failed: 'git failed (No such file or directory (os error 2)): ConPort settings were not read'
  })
  assert.deepEqual(gitDirOf({ code: 1, stdout: '', stderr: '' }), {
    failed: 'git failed (unknown error): ConPort settings were not read'
  })

  // Such a folder is set apart with that line: no project, so neither the old place nor a kept
  // binding is ever read for it.
  const spaces = [
    { id: 's1', name: 'acme', folders: ['/work/acme'] },
    { id: 's2', name: 'notes', folders: ['/work/notes'] }
  ]
  assert.deepEqual(mergeProjects(spaces, { '/work/acme': dubious, '/work/notes': null }), {
    projects: [],
    plain: [
      { folder: '/work/acme', spaces: ['s1'], reason: dubious.failed },
      { folder: '/work/notes', spaces: ['s2'], reason: NO_GIT }
    ]
  })
})

// What a git with translations writes for a folder outside git under LANG=ru_RU: Herdr's `exec`
// takes no environment, so the mod cannot ask git in English.
const RUSSIAN_OUTSIDE = { code: 128, stdout: '', stderr: 'fatal: не найден git репозиторий (или один из родительских каталогов): .git\n' }

test('a git refusal in any language is "outside git" when no folder up to the root holds .git', async (t) => {
  const top = scratch(t)
  const deep = join(top, 'notes', 'deep')
  mkdirSync(deep, { recursive: true })
  /** @type {string[]} */
  const asked = []
  const read = async (/** @type {string} */ path) => {
    asked.push(path)
    return readText(path)
  }
  const russian = gitDirOf(RUSSIAN_OUTSIDE)
  assert.equal(typeof russian?.failed, 'string')
  assert.equal(await settleGitDir(russian, deep, read), null)
  // Every folder from the one asked about up to the root is looked at, the root's own `.git` too.
  assert.deepEqual(asked.slice(0, 3), [`${deep}/.git`, `${top}/notes/.git`, `${top}/.git`])
  assert.equal(asked.at(-1), '/.git')
  // A trailing slash names the same folder.
  assert.equal(await settleGitDir(russian, `${deep}/`, readText), null)
  // A folder git could not even start on is outside git too, when nothing above holds .git.
  assert.equal(await settleGitDir(gitDirOf({ code: -1, stderr: 'No such file or directory (os error 2)' }), deep, readText), null)
  // Such a folder is set apart as a folder without git, not as a git failure.
  const spaces = [{ id: 's1', name: 'notes', folders: [deep] }]
  assert.deepEqual(mergeProjects(spaces, { [deep]: await settleGitDir(russian, deep, readText) }).plain, [
    { folder: deep, spaces: ['s1'], reason: NO_GIT }
  ])
})

test('a git refusal stands when the folder or a folder above holds .git, or .git cannot be looked at', async (t) => {
  const top = scratch(t)
  const root = repository(join(top, 'acme'))
  const deep = join(root, 'backend', 'app')
  mkdirSync(deep, { recursive: true })
  const russian = gitDirOf(RUSSIAN_OUTSIDE)
  // `.git` a folder above (Herdr rejects reading a folder with EISDIR) and in the folder itself.
  assert.deepEqual(await settleGitDir(russian, deep, readText), russian)
  assert.deepEqual(await settleGitDir(russian, root, readText), russian)
  // `.git` a file, as in a linked worktree or a submodule.
  const linked = join(top, 'linked')
  mkdirSync(linked)
  writeFileSync(join(linked, '.git'), 'gitdir: /work/elsewhere/.git/worktrees/linked\n')
  assert.deepEqual(await settleGitDir(russian, linked, readText), russian)
  // A `.git` that cannot be looked at is no proof of being outside git.
  const locked = join(top, 'locked')
  mkdirSync(locked)
  const denied = async (/** @type {string} */ path) => {
    if (path === `${locked}/.git`) throw new Error(READS['readTextFile(<a file with mode 000>)'].rejected)
    return readText(path)
  }
  assert.deepEqual(await settleGitDir(russian, locked, denied), russian)
  // A path through a file counts as absent, as one that is not there.
  const through = async (/** @type {string} */ path) => {
    if (path === `${locked}/.git`) throw new Error('`herdr.readTextFile`: Not a directory (os error 20)')
    if (path === `${top}/.git`) throw new Error('`herdr.readTextFile`: No such file or directory (os error 2)')
    return readText(path)
  }
  assert.equal(await settleGitDir(russian, locked, through), null)
})

test('what git answered is kept, and nothing read, unless it refused', async () => {
  /** @type {string[]} */
  const asked = []
  const read = async (/** @type {string} */ path) => {
    asked.push(path)
    return null
  }
  assert.equal(await settleGitDir('/work/acme/.git', '/work/acme', read), '/work/acme/.git')
  assert.equal(await settleGitDir(null, '/work/notes', read), null)
  assert.deepEqual(asked, [])
})

test('what the panel shows of a binding', () => {
  const binding = (/** @type {object} */ patch) => ({ project: null, source: null, lines: [], blocked: false, mainCheckout: true, ...patch })
  // A project: its epics and tasks, the lines above them when there are any.
  assert.deepEqual(bindingParts(binding({ project: 'acme', source: 'file' })), {
    settings: false, bind: false, bindNote: null, lists: true
  })
  assert.deepEqual(bindingParts(binding({ project: 'acme', source: 'stored', lines: ['a line'] })), {
    settings: true, bind: false, bindNote: null, lists: true
  })
  // No project: the card that asks for one, with the lines when there are any.
  assert.deepEqual(bindingParts(binding({})), { settings: false, bind: true, bindNote: NO_SETTINGS_NOTE, lists: false })
  assert.deepEqual(bindingParts(binding({ lines: ['a line'] })), { settings: true, bind: true, bindNote: NO_SETTINGS_NOTE, lists: false })
  assert.equal(NO_SETTINGS_NOTE, 'The repository has no .conport.json with project_name. The mod remembers the project for this repository.')
  // A broken file: its lines only, no card to remember a project.
  assert.deepEqual(bindingParts(binding({ lines: ['.conport.json cannot be read (EISDIR): fix it'], blocked: true })), {
    settings: true, bind: false, bindNote: null, lists: false
  })
  // A submodule or a worktree of a bare repository: the card says its files are not read.
  assert.deepEqual(bindingParts(binding({ mainCheckout: false })), {
    settings: false, bind: true, bindNote: NO_MAIN_CHECKOUT_NOTE, lists: false
  })
  assert.equal(
    NO_MAIN_CHECKOUT_NOTE,
    'This repository is a submodule or a worktree of a bare repository: ConPort settings files are not read here. Bind a project below.'
  )
  assert.deepEqual(bindingParts(binding({ mainCheckout: false, project: 'acme', source: 'stored' })), {
    settings: false, bind: false, bindNote: null, lists: true
  })
})

test('a repository without a main checkout carries that to its binding', () => {
  const bare = { shared: null, local: null, localIgnored: null, legacy: null, userEnv: null, mainCheckout: false }
  assert.deepEqual(projectBinding(bare, null), { project: null, source: null, lines: [], blocked: false, mainCheckout: false })
  assert.deepEqual(projectBinding(bare, 'acme'), { project: 'acme', source: 'stored', lines: [], blocked: false, mainCheckout: false })
})
