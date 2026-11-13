// The projects of the mod: the git repositories the spaces of this machine stand in. Checkouts
// of one repository, those under ~/.herdr/worktrees too, are one project, told apart by the
// absolute git directory they share.
import { trimSlash } from './git.js'
import { localSpaces } from './session.js'

/** @import { PaneInfo, SpaceInfo } from 'herdr' */

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
 * A folder of the spaces that is in no repository, and why it is not a project.
 * @typedef {{folder: string, spaces: string[], reason: string}} PlainFolder
 */

/**
 * The ConPort project of a repository and where it was read: the repository's settings or the
 * binding the person kept.
 * @typedef {{project: string | null, source: 'repository' | 'stored' | null}} Binding
 */

/** Why a folder without git is not a project. */
export const NO_GIT = 'Folder without git — nothing to run'

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

/** The main checkout of a repository by its git directory: the folder that holds `.git`. */
const rootOf = (/** @type {string} */ gitDir) => {
  const dir = trimSlash(gitDir)
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : dir
}

/**
 * The projects of `spaces` (`spaceFolders`), merged by git directory, in the order they first
 * appear: `{gitDir, root, name, spaces, folders}`; and the folders without git, `{folder,
 * spaces, reason}`. `gitDirs` maps each folder to the absolute git directory git printed for it,
 * or null when the folder is in no repository.
 * @param {SpaceFolders[]} spaces
 * @param {Record<string, string | null>} gitDirs
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
      } else if (found === null) {
        const item = plain.find((p) => p.folder === folder) ?? { folder, spaces: [], reason: NO_GIT }
        add(plain, item, space.id)
      }
    }
  }
  return { projects, plain }
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
 * The ConPort project of a repository: CONPORT_PROJECT_NAME of its `.claude/settings.local.json`
 * (`settingsText`, null when there is none), else the binding kept in the shared state.
 * @param {string | null} settingsText
 * @param {unknown} shared
 * @returns {Binding}
 */
export function projectBinding(settingsText, shared) {
  if (typeof settingsText === 'string') {
    try {
      const value = JSON.parse(settingsText)?.env?.CONPORT_PROJECT_NAME
      if (typeof value === 'string' && value.trim() !== '') return { project: value.trim(), source: 'repository' }
    } catch {
      // A settings file that is no JSON names no project.
    }
  }
  if (typeof shared === 'string' && shared.trim() !== '') return { project: shared.trim(), source: 'stored' }
  return { project: null, source: null }
}
