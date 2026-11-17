// When and how the mod reads the SDD stages of its project: the full read `sdd list` on open, on
// Refresh, after a start of its own and every 10 minutes; the light read `sdd list --taken` every
// minute, which marks the taken rows and starts the full read when the set changed. One read at a
// time. No gpui-kit and no Herdr here: the CLI and the clock are handed in, so tests drive it.
import { needsFullRead, sddListArgs, sddTakenArgs } from './cli.js'
import { pollStep } from './screen.js'

/** @import { SddList, SddTaken } from './cli.js' */
/** @import { Refusal, Result } from './refusals.js' */

/**
 * The project a read is for: its handle and the folder the CLI runs in.
 * @typedef {{project: string, root: string}} ReadTarget
 */

/**
 * What the reader is handed: the CLI (`runCli` with Herdr's exec bound), the clock, the project
 * to read (null while none is shown), and what to do after a read changed what is shown —
 * `full` when the list was read in full.
 * @typedef {{run: (args: string[], cwd: string) => Promise<Result<any>>, now: () => number, target: () => ReadTarget | null, changed: (full: boolean) => void}} ReaderDeps
 */

export class ListReader {
  /** @param {ReaderDeps} deps */
  constructor(deps) {
    this.deps = deps
    /**
     * The last full read, null before the first one of the project.
     * @type {Result<SddList> | null}
     */
    this.list = null
    /**
     * The last light read since the full read, null for none: the taken rows are then the list's.
     * @type {SddTaken | null}
     */
    this.taken = null
    /**
     * Why the last full read failed while an earlier list stays shown.
     * @type {Refusal | null}
     */
    this.listError = null
    /** When the last full read was answered, by the clock; 0 for never. */
    this.lastFull = 0
    /** A read runs: no other starts; a full read asked meanwhile follows it (`fullAgain`). */
    this.reading = false
    this.fullAgain = false
    /** Bumped by `reset`: an answer of an earlier project is thrown away. */
    this.generation = 0
  }

  /** Another project: what was read goes, and a read still running for the old one is ignored. */
  reset() {
    this.generation++
    this.list = null
    this.taken = null
    this.listError = null
    this.lastFull = 0
  }

  /**
   * A tick of the timer: the light read, or the full read once `FULL_READ_MS` passed since the
   * last; null — nothing started — while a read runs or no project is shown. While no list was
   * read (the last full read failed with none shown), no light read runs: the full read is tried
   * again on its own schedule, `FULL_READ_MS` after the failed one.
   * @returns {Promise<void> | null}
   */
  tick() {
    if (this.deps.target() === null) return null
    const step = pollStep({ reading: this.reading, sinceFull: this.deps.now() - this.lastFull })
    if (step === 'taken' && this.list?.ok !== true) return null
    return step === 'none' ? null : this.read(step)
  }

  /**
   * Reads `full` (`sdd list`) or `taken` (`sdd list --taken`, then the full read when
   * `needsFullRead` asks for it). While a read runs, a full read asked is done once after it and
   * a light one is dropped. A full read that fails keeps the list shown and says why in
   * `listError`; a light read that fails changes nothing.
   * @param {'full' | 'taken'} kind
   * @returns {Promise<void>}
   */
  async read(kind) {
    if (this.reading) {
      if (kind === 'full') this.fullAgain = true
      return
    }
    const target = this.deps.target()
    if (target === null) return
    this.reading = true
    try {
      await this.once(kind, target, this.generation)
    } finally {
      this.reading = false
    }
    if (this.fullAgain) {
      this.fullAgain = false
      await this.read('full')
    }
  }

  /**
   * @param {'full' | 'taken'} kind
   * @param {ReadTarget} target
   * @param {number} generation
   */
  async once(kind, { project, root }, generation) {
    const { run, now, changed } = this.deps
    if (kind === 'taken') {
      // Without a list a light read has nothing to mark: the full read follows its own schedule.
      if (this.list?.ok !== true) return
      const taken = await run(sddTakenArgs(project), root)
      if (generation !== this.generation || taken.ok === false) return
      this.taken = taken.data
      changed(false)
      if (!needsFullRead(this.list?.ok ? this.list.data : null, taken.data)) return
    }
    const list = await run(sddListArgs(project), root)
    if (generation !== this.generation) return
    this.lastFull = now()
    if (list.ok === false && this.list?.ok === true) this.listError = list.error
    else {
      this.list = list
      this.listError = null
      this.taken = null
    }
    changed(true)
  }
}
