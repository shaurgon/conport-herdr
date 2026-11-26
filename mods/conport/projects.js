// The projects of the mod: the git repositories the spaces of this machine stand in. Checkouts
// of one repository, those under ~/.herdr/worktrees too, are one project, told apart by the
// absolute git directory they share.
import { rejectionText } from './cli.js'
import { gitDirArgs, trimSlash } from './git.js'
import { localSpaces } from './session.js'
import { LOCAL_SETTINGS_FILE, resolveSettingsVerdict, SETTINGS_FILE } from './settings.js'

/** @import { PaneInfo, SpaceInfo } from 'herdr' */
/** @import { FileText } from './settings.js' */

/**
 * Herdr's `exec`, as far as the projects need it.
 * @typedef {(command: string, args: string[], options?: {timeout?: number}) => Promise<{code: number}>} Exec
 */

/**
 * A space of this machine with the live folders of its panes.
 * @typedef {{id: string, name: string, folders: string[]}} SpaceFolders
 */

/**
 * A git repository the spaces stand in: its git directory, its main checkout, its name, the
 * spaces and the folders of it.
 * @typedef {{gitDir: string, root: string, name: string, spaces: string[], folders: string[]}} Project
 */

/**
 * A folder of the spaces that is in no repository, or one git failed on, and why it is not a
 * project.
 * @typedef {{folder: string, spaces: string[], reason: string}} PlainFolder
 */

/**
 * What git said of a folder: its absolute git directory, null when the folder is in no
 * repository, `{failed}` with the line to show when git failed otherwise.
 * @typedef {string | null | {failed: string}} GitDirAnswer
 */

/**
 * The texts the ConPort project of a repository is found from: `.conport.json` and
 * `.conport.local.json` of its main checkout, whether git ignores the personal one (null when
 * it is not there or git cannot tell) and the old place `.claude/settings.local.json`;
 * `mainCheckout` is false for a submodule or a bare repository, whose files are not read (true
 * when left out).
 * @typedef {{shared: FileText, local: FileText, localIgnored: boolean | null, legacy: string | null, mainCheckout?: boolean}} BindingTexts
 */

/**
 * The ConPort project of a repository and where it was read: its settings files (`file`), the
 * old place `.claude/settings.local.json` (`repository`) or the binding the person kept
 * (`stored`); the lines the settings rules tell, whether a broken settings file keeps every
 * source from naming the project (`blocked`), and whether the repository has a main checkout
 * whose files were read (`mainCheckout`).
 * @typedef {{project: string | null, source: 'file' | 'repository' | 'stored' | null, lines: string[], blocked: boolean, mainCheckout: boolean}} Binding
 */

/** Why a folder without git is not a project. */
export const NO_GIT = 'Folder without git — nothing to run'

/** The note of the card that asks for the project of a repository whose files name none. */
export const NO_SETTINGS_NOTE = 'The repository has no .conport.json with project_name. The mod remembers the project for this repository.'

/** The note of that card for a repository without a main checkout, whose files are not read. */
export const NO_MAIN_CHECKOUT_NOTE =
  'This repository is a submodule or a worktree of a bare repository: ConPort settings files are not read here. Bind a project below.'

/**
 * What `git rev-parse --path-format=absolute --git-common-dir` answered for a folder, as
 * `mergeProjects` takes it: the git directory; null when the folder is in no repository (or git
 * printed nothing); `{failed}` with `git failed (<first line of the error>): ConPort settings
 * were not read` for any other failure, so that the folder names no project and nothing stands
 * in for its settings.
 * @param {{code: number, stdout?: string, stderr?: string}} answer
 * @returns {GitDirAnswer}
 */
export function gitDirOf(answer) {
  const out = String(answer?.stdout ?? '').trim()
  if (answer?.code === 0) return out === '' ? null : out
  const error = String(answer?.stderr ?? '')
  if (/not a git repository/i.test(error)) return null
  const first = error.split('\n').map((line) => line.trim()).find(Boolean) ?? 'unknown error'
  return { failed: `git failed (${first}): ConPort settings were not read` }
}

/**
 * What git said of `folder` (`gitDirOf`), whatever language git speaks. Herdr's `exec` takes no
 * environment, so a git with translations says "not a git repository" in the person's language
 * and `gitDirOf` reads it as a failure. A refusal is therefore checked against the disk: when
 * neither the folder nor any folder above it up to the root holds a `.git` entry (looked for with
 * Herdr's `readTextFile`: a file is read, a folder rejects with EISDIR), the folder is outside git
 * — null — whatever the text. A `.git` that is there, or one that cannot be looked at, keeps the
 * refusal. A path through a file (`ENOTDIR`) counts as absent, as one that is not there.
 * @param {GitDirAnswer} answer
 * @param {string} folder
 * @param {(path: string) => Promise<string | null>} read
 * @returns {Promise<GitDirAnswer>}
 */
export async function settleGitDir(answer, folder, read) {
  if (answer === null || typeof answer === 'string') return answer
  // The root is the empty folder name: its `.git` is `/.git`.
  let dir = trimSlash(folder)
  for (;;) {
    try {
      if ((await read(`${dir}/.git`)) !== null) return answer
    } catch (error) {
      const code = readErrorCode(error)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return answer
    }
    const cut = dir.lastIndexOf('/')
    if (cut < 0) return null
    dir = dir.slice(0, cut)
  }
}

/**
 * Each space of this machine with the live folders of its panes, `{id, name, folders}`; a space
 * whose panes name no folder gives its own folder.
 * @param {SpaceInfo[]} spaces
 * @param {PaneInfo[]} panes
 * @returns {SpaceFolders[]}
 */
export function spaceFolders(spaces, panes) {
  return localSpaces(spaces).map((space) => {
    const tabs = new Set((space.tabs ?? []).map((tab) => tab.id))
    /** @type {string[]} */
    const folders = []
    for (const pane of panes ?? []) {
      if (tabs.has(pane.tab) && typeof pane.cwd === 'string' && pane.cwd !== '' && !folders.includes(pane.cwd)) {
        folders.push(pane.cwd)
      }
    }
    if (folders.length === 0 && typeof space.folder === 'string' && space.folder !== '') folders.push(space.folder)
    return { id: space.id, name: space.name, folders }
  })
}

/**
 * The main checkout of a repository by its git directory: the folder that holds `.git`; the git
 * directory itself for a repository without one.
 */
const rootOf = (/** @type {string} */ gitDir) => mainRootOf(gitDir) ?? trimSlash(gitDir)

/**
 * The projects of `spaces` (`spaceFolders`), merged by git directory, in the order they first
 * appear: `{gitDir, root, name, spaces, folders}`; and the folders without git, `{folder,
 * spaces, reason}`. `gitDirs` maps each folder to what git said of it (`gitDirOf`): the absolute
 * git directory, null when the folder is in no repository, `{failed}` when git failed on it —
 * such a folder is set apart with that line as its reason.
 * @param {SpaceFolders[]} spaces
 * @param {Record<string, GitDirAnswer>} gitDirs
 * @returns {{projects: Project[], plain: PlainFolder[]}}
 */
export function mergeProjects(spaces, gitDirs) {
  /** @type {Project[]} */
  const projects = []
  /** @type {PlainFolder[]} */
  const plain = []
  /**
   * @template {{spaces: string[], folders?: string[]}} T
   * @param {T[]} list
   * @param {T} item
   * @param {string} space
   * @param {string} [folder]
   */
  const add = (list, item, space, folder) => {
    if (!item.spaces.includes(space)) item.spaces.push(space)
    if (folder !== undefined && !item.folders.includes(folder)) item.folders.push(folder)
    if (!list.includes(item)) list.push(item)
  }
  for (const space of spaces ?? []) {
    for (const folder of space.folders ?? []) {
      const found = gitDirs?.[folder]
      if (typeof found === 'string' && found.trim() !== '') {
        const gitDir = trimSlash(found.trim())
        const root = rootOf(gitDir)
        const project = projects.find((p) => p.gitDir === gitDir) ?? {
          gitDir,
          root,
          name: root.split('/').at(-1),
          spaces: [],
          folders: []
        }
        add(projects, project, space.id, folder)
      } else {
        const failed = /** @type {{failed?: unknown} | null | undefined} */ (found)?.failed
        if (found !== null && typeof failed !== 'string') continue
        /** @type {PlainFolder} */
        const fresh = { folder, spaces: [], reason: typeof failed === 'string' ? failed : NO_GIT }
        add(plain, plain.find((p) => p.folder === folder) ?? fresh, space.id)
      }
    }
  }
  return { projects, plain }
}

/**
 * The folders of `spaces` (`spaceFolders`) git gave no answer for in `gitDirs`, in the order they
 * first appear. An answer of null (outside git) or a failure counts as one.
 * @param {SpaceFolders[]} spaces
 * @param {Record<string, GitDirAnswer>} gitDirs
 * @returns {string[]}
 */
export function unreadFolders(spaces, gitDirs) {
  /** @type {string[]} */
  const out = []
  for (const space of spaces ?? []) {
    for (const folder of space.folders ?? []) {
      if (!Object.hasOwn(gitDirs ?? {}, folder) && !out.includes(folder)) out.push(folder)
    }
  }
  return out
}

/**
 * What git says of each of `folders`, `{[folder]: GitDirAnswer}`: `gitDirOf` of
 * `git rev-parse --path-format=absolute --git-common-dir`, settled against the disk
 * (`settleGitDir`). A git that does not start is a failure like any other.
 * @param {string[]} folders
 * @param {{exec: (command: string, args: string[]) => Promise<{code: number, stdout?: string, stderr?: string}>, read: (path: string) => Promise<string | null>}} host
 * @returns {Promise<Record<string, GitDirAnswer>>}
 */
export async function askGitDirs(folders, { exec, read }) {
  /** @type {Record<string, GitDirAnswer>} */
  const dirs = {}
  await Promise.all(
    folders.map(async (folder) => {
      /** @type {GitDirAnswer} */
      let answer
      try {
        answer = gitDirOf(await exec('git', gitDirArgs(folder)))
      } catch (error) {
        // git did not start (not installed): a failure like any other, settled below — outside
        // git when no .git is up to the root, else the folder names no project and says why.
        answer = gitDirOf({ code: -1, stderr: rejectionText(error) })
      }
      // git speaks the person's language here: a refusal with no .git up to the root is outside git.
      dirs[folder] = await settleGitDir(answer, folder, read)
    })
  )
  return dirs
}

/**
 * What a catch-up (`followSpaces`) answered: every answer of git, the projects they make and the
 * project chosen.
 * @typedef {{gitDirs: Record<string, GitDirAnswer>, projects: Project[], chosen: string | null}} FollowAnswer
 */

/**
 * Whether the mod asks git about the folders the spaces reached since the last read: not while
 * the full read (`reading`) or another catch-up (`following`) runs, and only when a folder of
 * `spaces` has no answer in `gitDirs`.
 * @param {{reading: boolean, following: boolean}} state
 * @param {SpaceFolders[]} spaces
 * @param {Record<string, GitDirAnswer>} gitDirs
 * @returns {boolean}
 */
export function followNeeded({ reading, following }, spaces, gitDirs) {
  return !reading && !following && unreadFolders(spaces, gitDirs).length > 0
}

/**
 * The spaces reached folders git was not asked about: after a restart a window gives the mod its
 * spaces before their panes report their live folders, so the first read asks about the folders
 * the spaces started in. Asks git about the folders without an answer (`unreadFolders`) and
 * returns every answer, the projects they make and the project chosen. The choice the opening of
 * the panel would make now is `pickProject` with the focused space and `last` (the project chosen
 * before the restart; `chosen` when left out). `chosen` stays while it is still a project and
 * either the person picked it by hand (`byHand`) or that choice is a project git named before: a
 * `cd` into a new folder of a known project, or a new repository in a space out of focus, changes
 * nothing. Otherwise — the mod chose by itself from what it knew, and the opening would now choose
 * a project it did not know, as after a restart — that choice is taken. Null when every folder has
 * its answer.
 * @param {SpaceFolders[]} spaces
 * @param {Record<string, GitDirAnswer>} gitDirs
 * @param {{exec: (command: string, args: string[]) => Promise<{code: number, stdout?: string, stderr?: string}>, read: (path: string) => Promise<string | null>, chosen: string | null, byHand: boolean, last?: string | null, focusedSpace: string | null}} host
 * @returns {Promise<FollowAnswer | null>}
 */
export async function followSpaces(spaces, gitDirs, { exec, read, chosen, byHand, last = chosen, focusedSpace }) {
  const unread = unreadFolders(spaces, gitDirs)
  if (unread.length === 0) return null
  const all = { ...gitDirs, ...(await askGitDirs(unread, { exec, read })) }
  const { projects } = mergeProjects(spaces, all)
  // A git directory git named before is no new project, whichever folder named it.
  const seen = new Set(Object.values(gitDirs ?? {}).flatMap((dir) => (typeof dir === 'string' && dir.trim() !== '' ? [trimSlash(dir.trim())] : [])))
  const next = pickProject(projects, { focusedSpace, last })
  const kept = projects.some((project) => project.gitDir === chosen) && (byHand || seen.has(next))
  return { gitDirs: all, projects, chosen: kept ? chosen : next }
}

/**
 * What the mod keeps of a catch-up's answer, given what it started from (`started`) and what the
 * mod holds now (`now`). Nothing (null) when there is no answer, or a full read runs or ran
 * meanwhile (`reading`, or `gitDirs` is no longer the one asked from): that read asks about every
 * folder and chooses itself. A project the person picked meanwhile (`chosen` changed) stays; else
 * the answer's choice is taken and remembered (`remember`) when it is a new one. `load` says
 * whether the project is read again: its project differs from the one read last (`loadedFor`).
 * @param {FollowAnswer | null} answer
 * @param {{gitDirs: Record<string, GitDirAnswer>, chosen: string | null}} started
 * @param {{reading: boolean, gitDirs: Record<string, GitDirAnswer>, chosen: string | null, loadedFor: string | null}} now
 * @returns {{gitDirs: Record<string, GitDirAnswer>, chosen: string | null, remember: boolean, load: boolean} | null}
 */
export function settleFollow(answer, started, now) {
  if (answer === null || now.reading || now.gitDirs !== started.gitDirs) return null
  const chosen = now.chosen !== started.chosen ? now.chosen : answer.chosen
  const current = answer.projects.some((project) => project.gitDir === chosen) ? chosen : null
  return { gitDirs: answer.gitDirs, chosen, remember: chosen !== null && chosen !== now.chosen, load: current !== now.loadedFor }
}

/**
 * The project first chosen: that of the focused space, else the last chosen, else the first.
 * @param {Project[]} projects
 * @param {{focusedSpace: string | null, last: string | null}} choice
 * @returns {string | null}
 */
export function pickProject(projects, { focusedSpace, last }) {
  const list = projects ?? []
  const focused = list.find((project) => project.spaces?.includes(focusedSpace))
  if (focused) return focused.gitDir
  if (list.some((project) => project.gitDir === last)) return last
  return list[0]?.gitDir ?? null
}

/**
 * The main checkout of a repository by its git directory, the folder its settings files are
 * in; null for a submodule (`.git/modules/<name>`) or a bare repository (`<repo>.git`), which
 * have none.
 * @param {string} gitDir
 * @returns {string | null}
 */
export function mainRootOf(gitDir) {
  const dir = trimSlash(gitDir)
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : null
}

/** The error codes of the `os error N` Herdr's file reading rejects with. */
const OS_ERRORS = /** @type {Record<string, string>} */ ({ 2: 'ENOENT', 13: 'EACCES', 20: 'ENOTDIR', 21: 'EISDIR' })

/**
 * The error code of a file Herdr could not read, from the `(os error N)` its rejection ends with
 * (`herdr.readTextFile`: Is a directory (os error 21)); EIO for any other.
 * @param {unknown} error
 * @returns {string}
 */
export function readErrorCode(error) {
  const text = error instanceof Error ? error.message : String(error)
  const number = /\(os error (\d+)\)/.exec(text)?.[1]
  return (number !== undefined && OS_ERRORS[number]) || 'EIO'
}

/** The limit of each program the settings ask, as the conport plugin bounds its git calls. */
export const SETTINGS_GIT_TIMEOUT_MS = 5000

/**
 * Whether git ignores the personal settings file of the checkout `root` and does not track it:
 * true, false, or null when git cannot tell.
 * @param {Exec} exec
 * @param {string} root
 * @returns {Promise<boolean | null>}
 */
async function localIgnored(exec, root) {
  const limit = { timeout: SETTINGS_GIT_TIMEOUT_MS }
  try {
    const tracked = await exec('git', ['-C', root, 'ls-files', '--error-unmatch', '--', LOCAL_SETTINGS_FILE], limit)
    if (tracked.code === 0) return false
    if (tracked.code !== 1) return null
    const ignored = await exec('git', ['-C', root, 'check-ignore', '-q', '--', LOCAL_SETTINGS_FILE], limit)
    return ignored.code === 0 ? true : ignored.code === 1 ? false : null
  } catch {
    return null
  }
}

/**
 * The texts the ConPort project of a repository is found from (`projectBinding`): its
 * `.conport.json` and `.conport.local.json` in the main checkout and the old place
 * `.claude/settings.local.json`. A file that is not there — absent, or a
 * path through a file (`ENOENT`, `ENOTDIR`) — is null; a settings file that is there but
 * cannot be read is `{error}`. git is asked whether the personal file is ignored only when it
 * is there. A repository without a main checkout reads no file of its own (`mainCheckout`
 * false).
 * @param {{read: (path: string) => Promise<string | null>, exec: Exec, gitDir: string}} where
 * @returns {Promise<BindingTexts>}
 */
export async function readBindingTexts({ read, exec, gitDir }) {
  /** @returns {Promise<FileText>} */
  const settingsFile = async (/** @type {string} */ path) => {
    try {
      return await read(path)
    } catch (error) {
      const code = readErrorCode(error)
      return code === 'ENOENT' || code === 'ENOTDIR' ? null : { error: code }
    }
  }
  /** @returns {Promise<string | null>} */
  const plainFile = async (/** @type {string} */ path) => {
    try {
      return await read(path)
    } catch {
      return null
    }
  }
  const root = mainRootOf(gitDir)
  if (root === null) {
    return { shared: null, local: null, localIgnored: null, legacy: null, mainCheckout: false }
  }
  const [shared, local, legacy] = await Promise.all([
    settingsFile(`${root}/${SETTINGS_FILE}`),
    settingsFile(`${root}/${LOCAL_SETTINGS_FILE}`),
    plainFile(`${root}/.claude/settings.local.json`)
  ])
  return {
    shared,
    local,
    localIgnored: local === null ? null : await localIgnored(exec, root),
    legacy,
    mainCheckout: true
  }
}

/**
 * CONPORT_PROJECT_NAME of the old place, `env` of `.claude/settings.local.json`, or null.
 * @param {string | null} text
 * @returns {string | null}
 */
function legacyName(text) {
  if (typeof text !== 'string') return null
  try {
    const value = JSON.parse(text)?.env?.CONPORT_PROJECT_NAME
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  } catch {
    // An old settings file that is no JSON names no project.
    return null
  }
}

/**
 * The ConPort project of a repository: `project_name` of its `.conport.json` and
 * `.conport.local.json` by the settings rules, else CONPORT_PROJECT_NAME of the old place
 * `.claude/settings.local.json`, else the binding kept in the shared state (`stored`). No
 * environment variable enters the rules — the mod's process is Herdr's — and the old place is
 * read after them, as in the Orca plugin: it is no variable the file overrides, so it gives no
 * line. A settings file that is there but broken names no project, and nothing stands in for it
 * (`blocked`). `lines` are what the rules tell about the files.
 * @param {BindingTexts} texts
 * @param {unknown} stored
 * @returns {Binding}
 */
export function projectBinding({ shared, local, localIgnored, legacy, mainCheckout = true }, stored) {
  const verdict = resolveSettingsVerdict({ shared, local, localIgnored, env: {}, explicit: null })
  const { lines, blocked } = verdict
  if (verdict.project !== null) return { project: verdict.project, source: 'file', lines, blocked, mainCheckout }
  const name = blocked ? null : legacyName(legacy)
  if (name !== null) return { project: name, source: 'repository', lines, blocked, mainCheckout }
  if (!blocked && typeof stored === 'string' && stored.trim() !== '') {
    return { project: stored.trim(), source: 'stored', lines, blocked, mainCheckout }
  }
  return { project: null, source: null, lines, blocked, mainCheckout }
}

/**
 * What the panel shows of a binding: the card of the settings lines (`settings`), the card that
 * asks for the project (`bind`) with its note (`bindNote`, null without the card), the epics
 * and tasks of the project (`lists`). A broken settings file shows its lines only: the person
 * fixes the file, a remembered project would not count. A repository without a main checkout
 * says that its settings files are not read, not that it has none.
 * @param {Binding} binding
 * @returns {{settings: boolean, bind: boolean, bindNote: string | null, lists: boolean}}
 */
export function bindingParts(binding) {
  const bind = !binding.blocked && binding.project === null
  return {
    settings: binding.lines.length > 0,
    bind,
    bindNote: bind ? (binding.mainCheckout === false ? NO_MAIN_CHECKOUT_NOTE : NO_SETTINGS_NOTE) : null,
    lists: binding.project !== null
  }
}

