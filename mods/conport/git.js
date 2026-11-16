// Where an epic lives in a repository: its root, its base, and the branch epic-<N> and its copy
// an earlier start left. The mod runs git through Herdr's exec; these functions build its
// arguments and read what it printed.

/** @import { Refused, Result } from './refusals.js' */

/**
 * A checkout of `git worktree list --porcelain`.
 * @typedef {{path: string, head: string | null, branch: string | null, detached: boolean, bare: boolean}} Worktree
 */

/**
 * Where an epic runs: its root, its base, its copy, and whether that copy is there.
 * @typedef {{root: string, base: string, worktree: string, copy: 'existing' | 'branch' | 'new'}} Place
 */

/** The limit of `git worktree add`: a large repository takes long to check out. */
export const WORKTREE_ADD_TIMEOUT_MS = 600000

/** A path without its trailing slashes. */
export const trimSlash = (/** @type {string} */ path) => String(path).replace(/\/+$/, '')
const branchName = (/** @type {string | null | undefined} */ ref) => (ref ?? '').replace(/^refs\/heads\//, '')

/** The checkouts of the repository at `folder`; the first is the root. */
export const worktreeListArgs = (/** @type {string} */ folder) => ['-C', folder, 'worktree', 'list', '--porcelain']

/** The branch epic-<N> of the epic. */
export const epicRefsArgs = (/** @type {string} */ root, /** @type {number} */ epic) => ['-C', root, 'for-each-ref', `refs/heads/epic-${epic}`]

/** The git directory every checkout of the repository shares, as an absolute path. */
export const gitDirArgs = (/** @type {string} */ folder) => ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir']

/**
 * A copy at `worktree`: of the branch epic-<N> when it is there, else of a new one cut from `base`.
 * @param {{root: string, worktree: string, epic: number, base: string, branch: boolean}} copy
 * @returns {string[]}
 */
export function worktreeAddArgs({ root, worktree, epic, base, branch }) {
  return branch
    ? ['-C', root, 'worktree', 'add', worktree, `epic-${epic}`]
    : ['-C', root, 'worktree', 'add', worktree, '-b', `epic-${epic}`, base]
}

/**
 * The rows of `git worktree list --porcelain`: `{path, head, branch, detached, bare}`, the
 * branch without `refs/heads/`, null when the checkout is on none. The path is everything after
 * `worktree `, spaces and any letters kept.
 * @param {string | null | undefined} text
 * @returns {Worktree[]}
 */
export function parseWorktrees(text) {
  /** @type {Worktree[]} */
  const rows = []
  /** @type {Worktree | null} */
  let row = null
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      row = { path: line.slice('worktree '.length), head: null, branch: null, detached: false, bare: false }
      rows.push(row)
    } else if (row !== null && line.startsWith('HEAD ')) {
      row.head = line.slice('HEAD '.length)
    } else if (row !== null && line.startsWith('branch ')) {
      row.branch = branchName(line.slice('branch '.length))
    } else if (row !== null && line === 'detached') {
      row.detached = true
    } else if (row !== null && line === 'bare') {
      row.bare = true
    }
  }
  return rows
}

/**
 * The refnames `git for-each-ref` printed, in its default format or as bare names.
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function parseRefs(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).at(-1))
}

/**
 * `<home>/.herdr/worktrees/<repo>/epic-<N>`, `<repo>` being the name of the root folder.
 * @param {string} home
 * @param {string} root
 * @param {number} epic
 * @returns {string}
 */
export function epicWorktreePath(home, root, epic) {
  const repo = trimSlash(root).split('/').at(-1)
  return `${trimSlash(home)}/.herdr/worktrees/${repo}/epic-${epic}`
}

/** @returns {Refused} */
const refuse = (/** @type {string} */ code, /** @type {string} */ fact) => ({ ok: false, error: { code, fact, action: '' } })

/**
 * Where epic `epic` runs: `{root, base, worktree, copy}`. `copy` is `existing` for a checkout of
 * the branch epic-<N> wherever it is, `branch` for the branch without one, `new` when neither is
 * there; the last two get their copy at `<home>/.herdr/worktrees/<repo>/epic-<N>`. Refused:
 * `root_detached` when the main checkout is on no branch. `refs` is what for-each-ref printed,
 * or its refnames.
 * @param {{worktrees: Worktree[], refs: string | string[], epic: number, home: string}} found
 * @returns {Result<Place>}
 */
export function epicPlace({ worktrees, refs, epic, home }) {
  const [main] = worktrees ?? []
  if (!main) return refuse('git_failed', 'git listed no checkout of the repository')
  const names = typeof refs === 'string' ? parseRefs(refs) : refs ?? []
  // The pattern of the branch lists the branches under it too: only the exact name counts.
  const branch = names.includes(`refs/heads/epic-${epic}`)
  if (main.branch === null) return refuse('root_detached', 'the main checkout is on no branch')
  const root = main.path
  const existing = worktrees.find((row) => row.branch === `epic-${epic}`)
  /** @type {Place} */
  const data = existing
    ? { root, base: main.branch, worktree: existing.path, copy: 'existing' }
    : { root, base: main.branch, worktree: epicWorktreePath(home, root, epic), copy: branch ? 'branch' : 'new' }
  return { ok: true, data }
}
