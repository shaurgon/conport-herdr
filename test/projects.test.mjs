import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { gitDirArgs } from '../mods/conport/git.js'
import { mergeProjects, NO_GIT, pickProject, projectBinding, spaceFolders } from '../mods/conport/projects.js'
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

test('projectBinding: CONPORT_PROJECT_NAME of .claude/settings.local.json comes first', () => {
  const settings = JSON.stringify({ env: { CONPORT_PROJECT_NAME: ' acme-app ' }, permissions: {} })
  assert.deepEqual(projectBinding(settings, 'prk7m2qx9d'), { project: 'acme-app', source: 'repository' })
})

test('projectBinding: without it, the binding kept in the shared state', () => {
  assert.deepEqual(projectBinding(JSON.stringify({ env: {} }), 'prk7m2qx9d'), { project: 'prk7m2qx9d', source: 'stored' })
  assert.deepEqual(projectBinding(null, 'acme'), { project: 'acme', source: 'stored' })
  assert.deepEqual(projectBinding('{ not json', 'acme'), { project: 'acme', source: 'stored' })
  assert.deepEqual(projectBinding(JSON.stringify({ env: { CONPORT_PROJECT_NAME: '' } }), 'acme'), { project: 'acme', source: 'stored' })
})

test('projectBinding: neither, no project', () => {
  assert.deepEqual(projectBinding(null, undefined), { project: null, source: null })
  assert.deepEqual(projectBinding(null, '  '), { project: null, source: null })
  assert.deepEqual(projectBinding(null, 42), { project: null, source: null })
})
