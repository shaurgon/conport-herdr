// What the tests of the mod share: the recorded Herdr answers with one fake home put in place of
// `~`, and temporary git repositories made with the real git.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** The fake absolute home every record is read under. */
export const HOME = '/fake-home/tester'

/** The folder of the mod, as the tests import it. */
export const MOD_DIR = join(here, '..', 'mods', 'conport')

/** A record of `fixtures/`, `~` replaced by `home` wherever a path starts with it. */
export function record(name, home = HOME) {
  const text = readFileSync(join(here, 'fixtures', name), 'utf8')
  return JSON.parse(text.replace(/"~(?=[/"])/g, `"${home}`).replace(/ ~(?=\/)/g, ` ${home}`))
}

/** Runs git and answers its standard output. */
export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * A fresh folder for one test, its path resolved (macOS keeps temporary folders behind a link,
 * and git prints the resolved path). It is removed after the test.
 */
export function scratch(t, prefix = 'herdr-mod-') {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}

/** A repository at `root` on branch `main` with one commit. */
export function repository(root) {
  mkdirSync(root, { recursive: true })
  git(['init', '-q', '-b', 'main'], root)
  const quiet = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
  git([...quiet, 'commit', '-q', '--allow-empty', '-m', 'init'], root)
  return root
}
