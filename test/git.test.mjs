import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  epicPlace,
  epicRefsArgs,
  epicWorktreePath,
  gitDirArgs,
  mainCheckout,
  parseRefs,
  parseWorktrees,
  worktreeAddArgs,
  worktreeListArgs
} from '../mods/conport/git.js'
import { git, HOME, record, repository, scratch } from './records.mjs'

const ROOT = `${HOME}/src/acme-app`
const W = (epic) => `${HOME}/.herdr/worktrees/acme-app/epic-${epic}`

test('parseWorktrees reads the recorded list: the root first, each copy with its branch', () => {
  const rows = parseWorktrees(record('git-worktree-list.json').stdout)
  assert.deepEqual(
    rows.map(({ path, branch, detached }) => ({ path, branch, detached })),
    [
      { path: ROOT, branch: 'main', detached: false },
      { path: W(412), branch: 'epic-412', detached: false },
      { path: W(413), branch: 'epic-413', detached: false }
    ]
  )
  assert.equal(rows[0].head, 'ec78bda3d75d0f491ad8d9a027e22b6d25fd5fa8')
})

test('parseWorktrees reads a detached main checkout as on no branch', () => {
  const [root] = parseWorktrees(record('git-worktree-list-detached.json').stdout)
  assert.equal(root.path, ROOT)
  assert.equal(root.branch, null)
  assert.equal(root.detached, true)
})

test('parseRefs reads the default format of for-each-ref and the bare refname form', () => {
  assert.deepEqual(parseRefs(record('git-for-each-ref-epic.json').stdout), ['refs/heads/epic-412'])
  assert.deepEqual(parseRefs('a commit\trefs/heads/epic-414\na commit\trefs/heads/epic-414x\n'), [
    'refs/heads/epic-414',
    'refs/heads/epic-414x'
  ])
  assert.deepEqual(parseRefs(record('git-for-each-ref-none.json').stdout), [])
  assert.deepEqual(parseRefs('refs/heads/epic-9\n'), ['refs/heads/epic-9'])
})

test('the git command lines are the ones the spec names', () => {
  assert.deepEqual(worktreeListArgs('/r'), ['-C', '/r', 'worktree', 'list', '--porcelain'])
  assert.deepEqual(epicRefsArgs('/r', 412), ['-C', '/r', 'for-each-ref', 'refs/heads/epic-412'])
  assert.deepEqual(gitDirArgs('/r'), ['-C', '/r', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  assert.deepEqual(worktreeAddArgs({ root: '/r', worktree: '/w', epic: 7, base: 'main', branch: true }), [
    '-C', '/r', 'worktree', 'add', '/w', 'epic-7'
  ])
  assert.deepEqual(worktreeAddArgs({ root: '/r', worktree: '/w', epic: 7, base: 'main', branch: false }), [
    '-C', '/r', 'worktree', 'add', '/w', '-b', 'epic-7', 'main'
  ])
})

test('the path of a new copy is ~/.herdr/worktrees/<repo>/epic-<N>, <repo> the name of the root folder', () => {
  assert.equal(epicWorktreePath(HOME, ROOT, 415), W(415))
  assert.equal(epicWorktreePath(`${HOME}/`, `${ROOT}/`, 415), W(415))
})

const place = (worktrees, refs, epic) =>
  epicPlace({ worktrees: parseWorktrees(record(worktrees).stdout), refs: record(refs).stdout, epic, home: HOME })

test('epicPlace takes the copy of the branch epic-<N> as it is', () => {
  assert.deepEqual(place('git-worktree-list.json', 'git-for-each-ref-epic.json', 412), {
    ok: true,
    data: { root: ROOT, base: 'main', worktree: W(412), copy: 'existing' }
  })
})

test('epicPlace finds the copy of the epic wherever it is, not only under ~/.herdr/worktrees', () => {
  const text = `worktree ${ROOT}\nHEAD a\nbranch refs/heads/main\n\nworktree ${ROOT}-orca/epic-412\nHEAD a\nbranch refs/heads/epic-412\n\n`
  const placed = epicPlace({ worktrees: parseWorktrees(text), refs: 'a commit\trefs/heads/epic-412\n', epic: 412, home: HOME })
  assert.equal(placed.ok, true)
  assert.equal(placed.data.worktree, `${ROOT}-orca/epic-412`)
  assert.equal(placed.data.copy, 'existing')
})

test('epicPlace gives a branch without a copy a copy at <W>', () => {
  const text = `worktree ${ROOT}\nHEAD a\nbranch refs/heads/main\n\n`
  const placed = epicPlace({ worktrees: parseWorktrees(text), refs: record('git-for-each-ref-epic.json').stdout, epic: 412, home: HOME })
  assert.deepEqual(placed, { ok: true, data: { root: ROOT, base: 'main', worktree: W(412), copy: 'branch' } })
})

test('epicPlace makes a new branch and copy at <W> when neither is there', () => {
  assert.deepEqual(place('git-worktree-list.json', 'git-for-each-ref-none.json', 415), {
    ok: true,
    data: { root: ROOT, base: 'main', worktree: W(415), copy: 'new' }
  })
})

test('epicPlace places an epic whose only branches are epic<N>/…', () => {
  const refs = 'a commit\trefs/heads/epic414/final\na commit\trefs/heads/epic414/task-1\n'
  const placed = epicPlace({ worktrees: parseWorktrees(record('git-worktree-list.json').stdout), refs, epic: 414, home: HOME })
  assert.deepEqual(placed, { ok: true, data: { root: ROOT, base: 'main', worktree: W(414), copy: 'new' } })
})

test('epicPlace starts an epic whose branch epic-<N> is there beside epic<N>/… branches', () => {
  const refs = 'a commit\trefs/heads/epic-414\na commit\trefs/heads/epic414/task-1\n'
  const placed = epicPlace({ worktrees: parseWorktrees(record('git-worktree-list.json').stdout), refs, epic: 414, home: HOME })
  assert.equal(placed.ok, true)
  assert.equal(placed.data.copy, 'branch')
})

test('epicPlace counts only the branches of this epic: epic-41 is not epic-412', () => {
  const worktrees = parseWorktrees(record('git-worktree-list.json').stdout)
  const refs = 'a commit\trefs/heads/epic-412\na commit\trefs/heads/epic-41/x\n'
  const placed = epicPlace({ worktrees, refs, epic: 41, home: HOME })
  assert.deepEqual(placed, { ok: true, data: { root: ROOT, base: 'main', worktree: W(41), copy: 'new' } })
})

test('epicPlace refuses git_failed when git listed no checkout', () => {
  for (const worktrees of [[], parseWorktrees('')]) {
    const placed = epicPlace({ worktrees, refs: '', epic: 5, home: HOME })
    assert.equal(placed.ok, false)
    assert.equal(placed.error.code, 'git_failed')
  }
})

test('epicPlace refuses root_detached when the main checkout is on no branch', () => {
  const placed = place('git-worktree-list-detached.json', 'git-for-each-ref-epic.json', 412)
  assert.equal(placed.ok, false)
  assert.equal(placed.error.code, 'root_detached')
})

test('epicPlace takes the local branch of the main checkout as the base, not a remote one', () => {
  const text = `worktree ${ROOT}\nHEAD a\nbranch refs/heads/release/2.0\n\n`
  const placed = epicPlace({ worktrees: parseWorktrees(text), refs: '', epic: 5, home: HOME })
  assert.equal(placed.data.base, 'release/2.0')
})

test('mainCheckout: the root and the branch of the first checkout; no checkout or no branch refused', () => {
  assert.deepEqual(mainCheckout(parseWorktrees(record('git-worktree-list.json').stdout)), { ok: true, data: { root: ROOT, base: 'main' } })
  assert.deepEqual(mainCheckout([]), { ok: false, error: { code: 'git_failed', fact: 'git listed no checkout of the repository', action: '' } })
  assert.deepEqual(mainCheckout(null), mainCheckout([]))
  assert.deepEqual(mainCheckout(parseWorktrees(record('git-worktree-list-detached.json').stdout)), {
    ok: false,
    error: { code: 'root_detached', fact: 'the main checkout is on no branch', action: '' }
  })
})

test('on real repositories with spaces and non-ASCII letters in their paths, the copy is found, made and listed whole', (t) => {
  const top = scratch(t)
  const home = join(top, 'home of Τεστ')
  const root = repository(join(top, 'my repo ö 漢'))
  // A copy of epic 7 outside ~/.herdr/worktrees, and the branch of epic 8 without one.
  const elsewhere = join(top, 'αντίγραφα', 'epic 7')
  git(['worktree', 'add', '-q', elsewhere, '-b', 'epic-7', 'main'], root)
  git(['branch', 'epic-8', 'main'], root)

  const list = () => parseWorktrees(git(worktreeListArgs(elsewhere)))
  assert.equal(list()[0].path, root)
  const refs = (epic) => git(epicRefsArgs(root, epic), root)

  const seven = epicPlace({ worktrees: list(), refs: refs(7), epic: 7, home })
  assert.deepEqual(seven, { ok: true, data: { root, base: 'main', worktree: elsewhere, copy: 'existing' } })

  const eight = epicPlace({ worktrees: list(), refs: refs(8), epic: 8, home })
  assert.equal(eight.data.copy, 'branch')
  assert.equal(eight.data.worktree, join(home, '.herdr', 'worktrees', 'my repo ö 漢', 'epic-8'))
  git(worktreeAddArgs({ ...eight.data, epic: 8, branch: true }), root)

  const nine = epicPlace({ worktrees: list(), refs: refs(9), epic: 9, home })
  assert.equal(nine.data.copy, 'new')
  git(worktreeAddArgs({ ...nine.data, epic: 9, branch: false }), root)

  const after = list()
  assert.deepEqual([after[0].path, after[0].branch], [root, 'main'])
  assert.deepEqual(
    after.slice(1).map((row) => `${row.branch} ${row.path}`).sort(),
    [
      `epic-7 ${elsewhere}`,
      `epic-8 ${join(home, '.herdr', 'worktrees', 'my repo ö 漢', 'epic-8')}`,
      `epic-9 ${join(home, '.herdr', 'worktrees', 'my repo ö 漢', 'epic-9')}`
    ]
  )
  // Now there, the copies are taken as they are.
  assert.equal(epicPlace({ worktrees: after, refs: refs(9), epic: 9, home }).data.copy, 'existing')
})

test('on a real repository, branches epic<N>/… are not asked for and a detached main checkout refuses', (t) => {
  const root = repository(join(scratch(t), 'repo'))
  git(['branch', 'epic3/task-1', 'main'], root)
  const worktrees = () => parseWorktrees(git(worktreeListArgs(root)))
  const refs = git(epicRefsArgs(root, 3), root)
  assert.deepEqual(parseRefs(refs), [])
  assert.deepEqual(epicPlace({ worktrees: worktrees(), refs, epic: 3, home: HOME }), {
    ok: true,
    data: { root, base: 'main', worktree: join(HOME, '.herdr', 'worktrees', 'repo', 'epic-3'), copy: 'new' }
  })

  git(['checkout', '-q', '--detach'], root)
  const detached = epicPlace({ worktrees: worktrees(), refs: '', epic: 4, home: HOME })
  assert.equal(detached.error.code, 'root_detached')
})
