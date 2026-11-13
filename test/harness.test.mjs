import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ROLES,
  FIXER_TYPE,
  harnessChoices,
  harnessRun,
  HARNESSES,
  PREPARE_AGENTS,
  ROLE_TYPE_FORM
} from '../mods/conport/harness.js'
import { record } from './records.mjs'

test('the mod knows three harnesses by their keys in knownAgents()', () => {
  assert.deepEqual(
    HARNESSES.map(({ kind, key, label }) => ({ kind, key, label })),
    [
      { kind: 'claude', key: 'claude', label: 'Claude Code' },
      { kind: 'codex', key: 'codex', label: 'Codex' },
      { kind: 'cursor', key: 'cursor', label: 'Cursor' }
    ]
  )
  assert.deepEqual(PREPARE_AGENTS, ['claude', 'codex', 'cursor'])
})

test('harnessChoices takes run and installed from the recorded knownAgents(), leaving other keys out', () => {
  const choices = harnessChoices(record('known-agents.json'))
  assert.deepEqual(
    choices.map(({ kind, installed, run }) => ({ kind, installed, run })),
    [
      { kind: 'claude', installed: true, run: ['claude'] },
      { kind: 'codex', installed: true, run: ['codex', '--no-daemon'] },
      { kind: 'cursor', installed: false, run: null }
    ]
  )
})

test('harnessChoices does not lean on the order of knownAgents()', () => {
  const known = record('known-agents.json').reverse()
  assert.deepEqual(
    harnessChoices(known).map((c) => [c.kind, c.installed, c.run]),
    [
      ['claude', true, ['claude']],
      ['codex', true, ['codex', '--no-daemon']],
      ['cursor', false, null]
    ]
  )
})

test('a harness whose key is not in knownAgents() is not installed', () => {
  const known = record('known-agents.json').filter((agent) => agent.key !== 'codex')
  const codex = harnessChoices(known).find((c) => c.kind === 'codex')
  assert.equal(codex.installed, false)
  assert.equal(codex.run, null)
})

test('a harness listed as installed with an empty run cannot be started', () => {
  const known = record('known-agents.json').map((agent) => (agent.key === 'claude' ? { ...agent, run: [] } : agent))
  const claude = harnessChoices(known).find((c) => c.kind === 'claude')
  assert.deepEqual([claude.installed, claude.run], [false, null])
  assert.equal(harnessRun(known, 'claude').error.code, 'harness_missing')
})

test('the run of a harness is the one knownAgents() names, not a table of the mod', () => {
  const known = record('known-agents.json').map((agent) => (agent.key === 'claude' ? { ...agent, run: ['claude-next', '--x'] } : agent))
  assert.deepEqual(harnessRun(known, 'claude'), { ok: true, data: ['claude-next', '--x'] })
})

test('harnessRun refuses a harness that is not installed or not known', () => {
  const known = record('known-agents.json')
  const cursor = harnessRun(known, 'cursor')
  assert.equal(cursor.ok, false)
  assert.equal(cursor.error.code, 'harness_missing')
  assert.equal(cursor.error.fact, 'Cursor')
  assert.equal(harnessRun(known, 'gemini').error.code, 'harness_missing')
})

test('the roles start with the types of the conport plugin and a type is a plain name', () => {
  assert.deepEqual(DEFAULT_ROLES, {
    implementer: 'conport:sdd-implementer',
    reviewer: 'conport:sdd-task-reviewer',
    gapHunter: 'conport:sdd-gap-hunter',
    finalReviewer: 'conport:sdd-final-reviewer'
  })
  assert.equal(FIXER_TYPE, 'conport:sdd-fixer')
  assert.ok(ROLE_TYPE_FORM.test('my-plugin:reviewer.v2'))
  assert.ok(!ROLE_TYPE_FORM.test('rm -rf'))
})
