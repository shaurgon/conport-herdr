import assert from 'node:assert/strict'
import test from 'node:test'
import { sddListArgs, sddSections, sddTakenArgs } from '../mods/conport/cli.js'
import { ListReader } from '../mods/conport/reader.js'
import { FULL_READ_MS, rowTaken, takenMap } from '../mods/conport/screen.js'

const PROJECT = 'prk7m2qx9d'
const ROOT = '/r'

/** A list of `conport sdd list --json`: epic 1820 and idea 2117 in progress, idea 2116 to do. */
const LIST = (extra = {}) => ({
  project: PROJECT,
  in_work: [
    { id: 1820, title: 'Search', status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', progress: { open: 1, total: 3 }, milestone: null, ready: false, reason: null, spec: null, idea: null }
  ],
  specs: [],
  ideas: [
    { id: 2116, kind: 'task', title: 'a', status: 'TODO', priority: 3, changes_requested: false },
    { id: 2117, kind: 'task', title: 'b', status: 'IN_PROGRESS', updated_at: '2026-11-17T08:00:00Z', priority: 3, changes_requested: false }
  ],
  proposals: [],
  outside: [],
  ...extra
})

const TAKEN = (...ids) => ({ project: PROJECT, taken: ids.map((id) => ({ id, kind: 'task', updated_at: '2026-11-17T10:00:00Z' })) })

/**
 * A stand-in for `runCli`: every call waits until the test answers it, so a test decides what
 * runs while a read is in flight. `calls` holds each call with `answer(result)`.
 */
function fakeCli() {
  const calls = []
  const run = (args, cwd) =>
    new Promise((resolve) => {
      calls.push({ args, cwd, answer: resolve, kind: args.includes('--taken') ? 'taken' : 'full' })
    })
  return { run, calls }
}

/** Lets every promise that waits on an answered call go on. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** A reader of project PROJECT in ROOT with the fake CLI and a clock the test moves. */
function reader({ target = { project: PROJECT, root: ROOT } } = {}) {
  const cli = fakeCli()
  const clock = { now: 1_000_000 }
  const changes = []
  const read = new ListReader({ run: cli.run, now: () => clock.now, target: () => read.target, changed: (full) => changes.push(full) })
  read.target = target
  return { read, cli, clock, changes }
}

/** A reader that already holds LIST from a full read. */
async function withList(list = LIST()) {
  const r = reader()
  const done = r.read.read('full')
  r.cli.calls[0].answer({ ok: true, data: list })
  await done
  r.cli.calls.length = 0
  r.changes.length = 0
  return r
}

test('the reader reads sdd list in full and sdd list --taken for the light read, in the root of the project', async () => {
  const r = await withList()
  assert.deepEqual(r.read.list, { ok: true, data: LIST() })
  assert.equal(r.read.lastFull, 1_000_000)
  const done = r.read.read('taken')
  assert.deepEqual(r.cli.calls.map((call) => [call.args, call.cwd]), [[sddTakenArgs(PROJECT), ROOT]])
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117) })
  await done
  assert.deepEqual(sddListArgs(PROJECT), ['sdd', 'list', '-p', PROJECT, '--json'])
})

test('an unknown number in the light read starts the full read, which drops the light read', async () => {
  const r = await withList()
  r.clock.now += 60_000
  const done = r.read.read('taken')
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117, 9999) })
  await settle()
  // The light read is marked at once, then the full read runs.
  assert.deepEqual(r.read.taken, TAKEN(1820, 2117, 9999))
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'full'])
  const fresh = LIST({ ideas: [...LIST().ideas, { id: 9999, kind: 'task', title: 'new', status: 'IN_PROGRESS', priority: 3, changes_requested: false }] })
  r.cli.calls[1].answer({ ok: true, data: fresh })
  await done
  assert.deepEqual(r.read.list.data, fresh)
  // The full list now says what is taken: the light read of before is dropped.
  assert.equal(r.read.taken, null)
  assert.equal(r.read.lastFull, 1_060_000)
  // Herdr is asked to redraw after the light read marked the rows and after the full read.
  assert.deepEqual(r.changes, [false, true])
})

test('a row of the list taken from another client is marked by the light read alone, with no full read', async () => {
  const r = await withList()
  const done = r.read.read('taken')
  // Idea 2116, in TODO in the list, is taken now.
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117, 2116) })
  await done
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken'])
  assert.deepEqual(r.read.taken, TAKEN(1820, 2117, 2116))
  const idea = sddSections(r.read.list.data).ideas.find((row) => row.id === 2116)
  assert.equal(rowTaken(idea, takenMap(r.read.taken)), true)
  assert.equal(r.read.lastFull, 1_000_000)
})

test('a full read asked while a read runs follows it exactly once', async () => {
  const r = await withList()
  const light = r.read.read('taken')
  // Two starts of the mod's own while the light read runs: one full read after it.
  const first = r.read.read('full')
  const second = r.read.read('full')
  await Promise.all([first, second])
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken'])
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117) })
  await settle()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'full'])
  r.cli.calls[1].answer({ ok: true, data: LIST() })
  await light
  await settle()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'full'])
  assert.equal(r.read.reading, false)
})

test('a project changed in the middle of a read throws its answer away', async () => {
  const r = await withList()
  const done = r.read.read('full')
  // The person picks another project: the list goes, and the answer of the old one is not taken.
  r.read.reset()
  r.read.target = { project: 'prother0000', root: '/other' }
  const next = r.read.read('full')
  assert.equal(r.read.list, null)
  r.cli.calls[0].answer({ ok: true, data: LIST() })
  await settle()
  assert.equal(r.read.list, null)
  assert.equal(r.read.lastFull, 0)
  // The full read of the new project, asked while the old one ran, followed it.
  assert.deepEqual(r.cli.calls.map((call) => [call.kind, call.args.at(-2)]), [
    ['full', PROJECT],
    ['full', 'prother0000']
  ])
  r.cli.calls[1].answer({ ok: true, data: LIST({ project: 'prother0000' }) })
  await Promise.all([done, next])
  assert.equal(r.read.list.data.project, 'prother0000')
})

test('a reset asks the full read of the new project after the read of the old one', async () => {
  const r = await withList()
  const done = r.read.read('taken')
  r.read.reset()
  r.read.target = { project: 'prother0000', root: '/other' }
  const next = r.read.read('full')
  r.cli.calls[0].answer({ ok: true, data: TAKEN(9999) })
  await settle()
  // The old light read is thrown away, its unknown number starts nothing for the new project.
  assert.equal(r.read.taken, null)
  assert.deepEqual(r.cli.calls.map((call) => [call.kind, call.cwd]), [
    ['taken', ROOT],
    ['full', '/other']
  ])
  r.cli.calls[1].answer({ ok: true, data: LIST({ project: 'prother0000' }) })
  await Promise.all([done, next])
  assert.equal(r.read.list.data.project, 'prother0000')
})

test('a failed full read keeps the list shown and says why; the next one clears it', async () => {
  const r = await withList()
  const refusal = { ok: false, error: { code: 'cli_timeout', fact: 'x', action: '' } }
  let done = r.read.read('full')
  r.cli.calls[0].answer(refusal)
  await done
  assert.deepEqual(r.read.list, { ok: true, data: LIST() })
  assert.deepEqual(r.read.listError, refusal.error)
  done = r.read.read('full')
  r.cli.calls[1].answer({ ok: true, data: LIST() })
  await done
  assert.equal(r.read.listError, null)
  // With no list shown yet, the refusal is the list: the screen says it instead of the sections.
  const empty = reader()
  done = empty.read.read('full')
  empty.cli.calls[0].answer(refusal)
  await done
  assert.deepEqual(empty.read.list, refusal)
  assert.equal(empty.read.listError, null)
})

test('a failed light read changes nothing', async () => {
  const r = await withList()
  let done = r.read.read('taken')
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117, 2116) })
  await done
  done = r.read.read('taken')
  r.cli.calls[1].answer({ ok: false, error: { code: 'cli_timeout', fact: 'x', action: '' } })
  await done
  assert.deepEqual(r.read.taken, TAKEN(1820, 2117, 2116))
  assert.deepEqual(r.read.list, { ok: true, data: LIST() })
  assert.equal(r.read.listError, null)
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'taken'])
})

test('tick: the light read every minute, the full read once 10 minutes passed, nothing while a read runs or with no project', async () => {
  const r = await withList()
  r.clock.now += FULL_READ_MS - 1
  let done = r.read.tick()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken'])
  // A tick while that read runs starts nothing.
  assert.equal(r.read.tick(), null)
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117) })
  await done
  r.clock.now += 1
  done = r.read.tick()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'full'])
  r.cli.calls[1].answer({ ok: true, data: LIST() })
  await done
  const none = reader({ target: null })
  assert.equal(none.read.tick(), null)
  assert.equal(await none.read.read('full'), undefined)
  assert.deepEqual(none.cli.calls, [])
})

test('a failed first full read is tried again 10 minutes after it, with no light read meanwhile', async () => {
  const r = reader()
  const refusal = { ok: false, error: { code: 'cli_timeout', fact: 'x', action: '' } }
  let done = r.read.tick()
  r.cli.calls[0].answer(refusal)
  await done
  assert.deepEqual(r.read.list, refusal)
  // A minute later, and up to 10 minutes after the failure: neither a light nor a full read.
  for (const step of [60_000, FULL_READ_MS - 60_000 - 1]) {
    r.clock.now += step
    assert.equal(r.read.tick(), null)
  }
  const light = r.read.read('taken')
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['full'])
  await light
  // 10 minutes after it: the full read again.
  r.clock.now += 1
  done = r.read.tick()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['full', 'full'])
  r.cli.calls[1].answer({ ok: true, data: LIST() })
  await done
  assert.deepEqual(r.read.list, { ok: true, data: LIST() })
})

test('needsFullRead: a taken unlisted idea asks for no full read', async () => {
  // Idea 2240 is in progress and a tagged spec clarifies it: the list read it and shows it nowhere.
  const r = await withList(LIST({ unlisted: [2240] }))
  let done = r.read.read('taken')
  r.cli.calls[0].answer({ ok: true, data: TAKEN(1820, 2117, 2240) })
  await settle()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken'])
  await done
  // Let go, it asks for nothing either.
  done = r.read.read('taken')
  r.cli.calls[1].answer({ ok: true, data: TAKEN(1820, 2117) })
  await settle()
  assert.deepEqual(r.cli.calls.map((call) => call.kind), ['taken', 'taken'])
  await done
  assert.equal(r.read.lastFull, 1_000_000)
})
