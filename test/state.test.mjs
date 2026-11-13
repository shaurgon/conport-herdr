import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_ROLES } from '../mods/conport/harness.js'
import {
  agentKey,
  bindingKey,
  chosenFor,
  epicKey,
  harnessKey,
  rememberStart,
  sharedKey
} from '../mods/conport/state.js'
import { HOME, record } from './records.mjs'

const GIT_DIR = record('git-common-dir.json').from_root.stdout.trim()

test('every shared key starts with conport: and the absolute git directory of the repository', () => {
  assert.equal(GIT_DIR, `${HOME}/src/acme-app/.git`)
  assert.equal(sharedKey(GIT_DIR, 'epic', 412), `conport:${HOME}/src/acme-app/.git:epic:412`)
  for (const key of [epicKey(GIT_DIR, 412), harnessKey(GIT_DIR), agentKey(GIT_DIR), bindingKey(GIT_DIR)]) {
    assert.ok(key.startsWith(`conport:${GIT_DIR}:`), key)
  }
  assert.equal(new Set([epicKey(GIT_DIR, 412), harnessKey(GIT_DIR), agentKey(GIT_DIR), bindingKey(GIT_DIR)]).size, 4)
})

test('a checkout and the root of one repository share their keys: the git directory is the same', () => {
  const { from_root: root, from_worktree: copy } = record('git-common-dir.json')
  assert.equal(epicKey(root.stdout.trim(), 412), epicKey(copy.stdout.trim(), 412))
  assert.equal(sharedKey(`${GIT_DIR}/`, 'x'), sharedKey(GIT_DIR, 'x'))
})

test('a start remembers the harness and the roles of the epic and the harness of the project', () => {
  const store = new Map()
  const roles = { ...DEFAULT_ROLES, reviewer: 'mine:reviewer' }
  rememberStart((key, value) => store.set(key, value), GIT_DIR, { epic: 412, harness: 'codex', roles })
  assert.deepEqual([...store.keys()].sort(), [epicKey(GIT_DIR, 412), harnessKey(GIT_DIR)].sort())
  assert.deepEqual(store.get(epicKey(GIT_DIR, 412)), { harness: 'codex', roles })
  assert.equal(store.get(harnessKey(GIT_DIR)), 'codex')

  const shared = (key) => store.get(key)
  assert.deepEqual(chosenFor(shared, GIT_DIR, 412), { harness: 'codex', roles })
  // A new epic takes the harness of the last start, with the default roles.
  assert.deepEqual(chosenFor(shared, GIT_DIR, 500), { harness: 'codex', roles: DEFAULT_ROLES })
})

test('nothing remembered: Claude Code with the default roles', () => {
  assert.deepEqual(chosenFor(() => undefined, GIT_DIR, 412), { harness: 'claude', roles: DEFAULT_ROLES })
})

test('roles remembered in part are not taken: the defaults stand', () => {
  const shared = (key) => (key === epicKey(GIT_DIR, 412) ? { harness: 'claude', roles: { implementer: 'x:y' } } : undefined)
  assert.deepEqual(chosenFor(shared, GIT_DIR, 412), { harness: 'claude', roles: DEFAULT_ROLES })
})
