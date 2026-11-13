import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { CLI_VERSION, MOD_VERSION } from '../mods/conport/version.js'
import { MOD_DIR } from './records.mjs'

test('MOD_VERSION is the version field of mod.json', () => {
  const manifest = JSON.parse(readFileSync(join(MOD_DIR, 'mod.json'), 'utf8'))
  assert.equal(MOD_VERSION, manifest.version)
  assert.equal(manifest.place, 'right')
})

test('CLI_VERSION is an exact release, never a range', () => {
  assert.match(CLI_VERSION, /^\d+\.\d+\.\d+$/)
})
