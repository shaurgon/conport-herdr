import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { MOD_DIR } from './records.mjs'

// ConPort has one interface language, English: the mod and its catalog page hold no Cyrillic word.
const CYRILLIC = /[\u0400-\u04FF]+/

test('no module of the mod, nor RECIPE.md or README.md, holds a Cyrillic word', () => {
  const files = readdirSync(MOD_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(MOD_DIR, name))
  files.push(join(MOD_DIR, '..', '..', 'RECIPE.md'), join(MOD_DIR, '..', '..', 'README.md'))
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => assert.doesNotMatch(line, CYRILLIC, `${file}:${i + 1}`))
  }
})
