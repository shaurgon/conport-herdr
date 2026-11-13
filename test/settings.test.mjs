import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { jsonErrorPosition, resolveSettings } from '../mods/conport/settings.js'

// The cases every reader of the ConPort settings files passes, read from the conport plugin of
// this repository. The mod has no search of the root from a folder, so it runs the `resolve`
// group only.
const here = dirname(fileURLToPath(import.meta.url))
const CASES = JSON.parse(
  readFileSync(join(here, '..', '..', 'conport-plugin', 'scripts', 'test', 'fixtures', 'project-config-cases.json'), 'utf8')
)

test('every resolve case of the shared fixture', () => {
  assert.ok(CASES.resolve.length > 0)
  for (const c of CASES.resolve) {
    assert.deepEqual(resolveSettings(c.input), c.expect, c.name)
  }
})

test('the JSON error position skips a byte order mark and counts columns in UTF-16 units', () => {
  assert.equal(jsonErrorPosition('﻿{"a": 1}\r\n'), null)
  assert.deepEqual(jsonErrorPosition('{\n  "a": 1,\n}'), { line: 3, column: 1 })
  assert.deepEqual(jsonErrorPosition('{"é😀": x}'), { line: 1, column: 9 })
  assert.deepEqual(jsonErrorPosition('{"a": 1'), { line: 1, column: 8 })
})
