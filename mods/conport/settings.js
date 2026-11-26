// The rules of the ConPort project settings: `.conport.json` in the project root, committed and
// shared by the team, and `.conport.local.json` beside it, ignored by git, for personal
// overrides. A copy of the rules of the conport plugin, kept to the same cases: the test runs
// the `resolve` group of the plugin's fixture against it. Pure functions over the texts of the
// two files and the environment; the mod reads the files itself.

/**
 * A file as the reader found it: its text, null when there is none, `{error}` when it is there
 * but cannot be read (a folder, no permission).
 * @typedef {string | {error: string} | null | undefined} FileText
 */

/**
 * What the rules read: both files, whether git ignores the personal one, the environment and an
 * explicit project.
 * @typedef {{shared: FileText, local: FileText, localIgnored?: boolean | null, env?: Record<string, unknown> | null, explicit?: string | null}} SettingsInput
 */

/**
 * The settings the files give.
 * @typedef {{plugins: Record<string, boolean>, arch: Record<string, unknown>, units?: unknown[], root?: string, roots?: Record<string, string>}} Settings
 */

/**
 * The project, where it came from, the settings and the lines to tell the person.
 * @typedef {{project: string | null, source: string | null, settings: Settings, lines: string[]}} Resolved
 */

/**
 * One file read by the rules: its lines, the keys that passed, whether it names no project at
 * all (`blocks`) and the project it names.
 * @typedef {{readError: string | null, lines: string[], values: {plugins?: Record<string, boolean>, arch?: Record<string, unknown>, units?: unknown[], root?: string, roots?: Record<string, string>}, blocks: boolean, name: string | null}} FileRead
 */

export const SETTINGS_FILE = '.conport.json'
export const LOCAL_SETTINGS_FILE = '.conport.local.json'

const API_KEY_NAMES = new Set(['api_key', 'apikey', 'conport_api_key'])
const API_KEY_PREFIX = 'cport_'

/** @type {Record<string, string>} */
const TYPE_WORDS = {
  project_name: 'a non-empty string',
  plugins: 'an object',
  'plugins.superpowers': 'true or false',
  'plugins.codegraph': 'true or false',
  arch: 'an object',
  'arch.ignore': 'a list of path patterns or {"path", "reason"} objects',
  'arch.git': 'true or false',
  units: 'a list',
  root: 'a root name: lower-case letters, digits and -, up to 32 characters, not none',
  roots: 'an object of root names and paths'
}

// The name of a root of the project: lower-case letters, digits and -, up to 32 characters, not
// `none` (which names "no root" where a root is asked for).
const ROOT_NAME = /^(?!none$)[a-z0-9][a-z0-9-]{0,31}$/

// --- JSON ----------------------------------------------------------------------------------------

const WS = new Set([0x20, 0x09, 0x0a, 0x0d])

const isDigit = (/** @type {number} */ c) => c >= 0x30 && c <= 0x39
const isHex = (/** @type {number} */ c) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)

/**
 * Offset of the first character at which `text` stops being the start of a valid JSON text
 * (RFC 8259), the length of the text when it ends too early, or -1 when the whole text is
 * valid. Iterative, so no input overflows the stack.
 * @param {string} text
 * @returns {number}
 */
function jsonErrorOffset(text) {
  const n = text.length
  let i = 0
  /** @type {string[]} */
  const stack = [] // '{' or '['
  const skip = () => {
    while (i < n && WS.has(text.charCodeAt(i))) i++
  }
  // Scans one string starting at its opening quote; returns -1 or the offset.
  const string = () => {
    i++
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 0x22) {
        i++
        return -1
      }
      if (c < 0x20) return i
      if (c === 0x5c) {
        i++
        if (i >= n) return n
        const e = text[i]
        if (e === 'u') {
          for (let k = 1; k <= 4; k++) {
            if (i + k >= n) return n
            if (!isHex(text.charCodeAt(i + k))) return i + k
          }
          i += 5
          continue
        }
        if ('"\\/bfnrt'.includes(e)) {
          i++
          continue
        }
        return i
      }
      i++
    }
    return n
  }
  const number = () => {
    if (text[i] === '-') i++
    if (i >= n) return n
    if (text[i] === '0') {
      i++
    } else if (isDigit(text.charCodeAt(i))) {
      while (i < n && isDigit(text.charCodeAt(i))) i++
    } else {
      return i
    }
    if (text[i] === '.') {
      i++
      if (i >= n) return n
      if (!isDigit(text.charCodeAt(i))) return i
      while (i < n && isDigit(text.charCodeAt(i))) i++
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (i >= n) return n
      if (!isDigit(text.charCodeAt(i))) return i
      while (i < n && isDigit(text.charCodeAt(i))) i++
    }
    // A digit right after a leading zero ends the number: `01` fails at `1` when the caller
    // looks for what may follow a value.
    return -1
  }
  const literal = (/** @type {string} */ word) => {
    for (let k = 0; k < word.length; k++) {
      if (i + k >= n) return n
      if (text[i + k] !== word[k]) return i + k
    }
    i += word.length
    return -1
  }
  // The key and colon of an object member, at the key.
  const memberKey = () => {
    skip()
    if (i >= n) return n
    if (text[i] !== '"') return i
    const bad = string()
    if (bad >= 0) return bad
    skip()
    if (i >= n) return n
    if (text[i] !== ':') return i
    i++
    return -1
  }
  // Scans one value. An opened container is pushed and the scan goes on to its first value; the
  // ends of containers are handled by the loop below.
  const value = () => {
    for (;;) {
      skip()
      if (i >= n) return n
      const ch = text[i]
      if (ch === '{' || ch === '[') {
        const close = ch === '{' ? '}' : ']'
        i++
        skip()
        if (i >= n) return n
        if (text[i] === close) {
          i++
          return -1
        }
        stack.push(ch)
        if (ch === '{') {
          const bad = memberKey()
          if (bad >= 0) return bad
        }
        continue
      }
      if (ch === '"') return string()
      if (ch === '-' || isDigit(text.charCodeAt(i))) return number()
      if (ch === 't') return literal('true')
      if (ch === 'f') return literal('false')
      if (ch === 'n') return literal('null')
      return i
    }
  }
  const member = () => {
    const bad = memberKey()
    return bad >= 0 ? bad : value()
  }

  let bad = value()
  while (bad < 0) {
    skip()
    if (!stack.length) return i < n ? i : -1
    if (i >= n) return n
    const top = stack[stack.length - 1]
    const ch = text[i]
    if (ch === ',') {
      i++
      bad = top === '{' ? member() : value()
    } else if ((top === '{' && ch === '}') || (top === '[' && ch === ']')) {
      i++
      stack.pop()
    } else {
      return i
    }
  }
  return bad
}

const stripBom = (/** @type {string} */ text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/**
 * Where `text` stops being valid JSON — line counted by `\n`, column as 1 plus the UTF-16 code
 * units after the last `\n` — or null when it is valid. A leading byte order mark is dropped
 * first and does not count.
 * @param {string} text
 * @returns {{line: number, column: number} | null}
 */
export function jsonErrorPosition(text) {
  const t = stripBom(String(text))
  const offset = jsonErrorOffset(t)
  if (offset < 0) return null
  const before = t.slice(0, offset)
  const lastNl = before.lastIndexOf('\n')
  let line = 1
  for (let k = 0; k < before.length; k++) if (before.charCodeAt(k) === 0x0a) line++
  return { line, column: offset - lastNl }
}

// --- The rules -----------------------------------------------------------------------------------

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * `__proto__` from JSON.parse is an own key; keep it one.
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {unknown} value
 */
const setOwn = (obj, key, value) => {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

const isApiKeyValue = (/** @type {unknown} */ v) => typeof v === 'string' && v.trimStart().startsWith(API_KEY_PREFIX)

/**
 * `value` without API keys: a key named like one is dropped with its value, a string starting
 * with `cport_` is dropped wherever it is, array elements included. `found.any` is set when
 * something was dropped.
 * @param {unknown} value
 * @param {{any: boolean}} found
 * @returns {unknown}
 */
function scrub(value, found) {
  if (Array.isArray(value)) {
    const out = []
    for (const item of value) {
      if (isApiKeyValue(item)) {
        found.any = true
        continue
      }
      out.push(scrub(item, found))
    }
    return out
  }
  if (isObject(value)) {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (API_KEY_NAMES.has(k.toLowerCase()) || isApiKeyValue(v)) {
        found.any = true
        continue
      }
      setOwn(out, k, scrub(v, found))
    }
    return out
  }
  return value
}

/**
 * A path pattern of the arch dialect: POSIX, from the project root, made of segments with `*`,
 * `**` and `?`, a trailing `/` for a folder. A blank string, a `\`, an empty segment (`a//b`; a
 * leading `/` makes one), a `.` or `..` segment are refused.
 * @param {unknown} p
 */
function isPattern(p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\\')) return false
  const body = p.endsWith('/') ? p.slice(0, -1) : p
  return body.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/**
 * An element of arch.ignore: a pattern, or an object of exactly a pattern `path` and a string
 * `reason`.
 * @param {unknown} e
 */
function isIgnoreEntry(e) {
  if (typeof e === 'string') return isPattern(e)
  if (!isObject(e)) return false
  return Object.keys(e).length === 2 && isPattern(e.path) && typeof e.reason === 'string'
}

const has = (/** @type {object} */ obj, /** @type {string} */ key) => Object.prototype.hasOwnProperty.call(obj, key)

/**
 * @param {unknown} v
 * @returns {v is string}
 */
const isRootName = (v) => typeof v === 'string' && ROOT_NAME.test(v)

/**
 * The paths of the other roots, as written: an object of root names and non-blank strings, or
 * null when one entry is not — the whole key is dropped.
 * @param {unknown} v
 * @returns {Record<string, string> | null}
 */
function readRoots(v) {
  if (!isObject(v)) return null
  /** @type {Record<string, string>} */
  const roots = {}
  for (const [name, p] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
    if (!isRootName(name) || typeof p !== 'string' || !p.trim()) return null
    roots[name] = p
  }
  return roots
}

/**
 * One file's text read by the rules.
 * @param {string} file
 * @param {FileText} input
 * @param {boolean} isLocal
 * @returns {FileRead}
 */
function readFile(file, input, isLocal) {
  /** @type {FileRead} */
  const out = { readError: null, lines: [], values: {}, blocks: false, name: null }
  if (input === null || input === undefined) return out
  if (typeof input === 'object') {
    out.readError = `${file} cannot be read (${input.error}): fix it`
    out.blocks = true
    return out
  }
  // The byte order mark is dropped once: jsonErrorPosition drops it for the check, JSON.parse
  // gets the same text without it.
  const pos = jsonErrorPosition(input)
  if (pos) {
    out.lines.push(`${file} is not valid JSON (line ${pos.line}, column ${pos.column}): fix it`)
    out.blocks = true
    return out
  }
  const parsed = JSON.parse(stripBom(input))
  if (!isObject(parsed)) {
    out.lines.push(`${file} must hold a JSON object — fix it`)
    out.blocks = true
    return out
  }
  const found = { any: false }
  const nameIsKey = has(parsed, 'project_name') && isApiKeyValue(parsed.project_name)
  const data = /** @type {Record<string, any>} */ (scrub(parsed, found))
  if (found.any) {
    out.lines.push(
      `${file} holds an API key: revoke it at https://me.conport.app/dashboard/connect, create a new one and keep it in ~/.config/conport/conport.key`
    )
  }
  if (nameIsKey) out.blocks = true
  const wrong = (/** @type {string} */ key) => out.lines.push(`${file}: ${key} must be ${TYPE_WORDS[key]} — fix it`)

  if (has(data, 'project_name')) {
    const v = data.project_name
    if (typeof v === 'string' && v.trim()) {
      out.name = v.trim()
    } else {
      wrong('project_name')
      out.blocks = true
    }
  }
  if (has(data, 'plugins')) {
    if (!isObject(data.plugins)) {
      wrong('plugins')
    } else {
      /** @type {Record<string, boolean>} */
      const plugins = {}
      for (const k of ['superpowers', 'codegraph']) {
        if (!has(data.plugins, k)) continue
        if (typeof data.plugins[k] === 'boolean') plugins[k] = data.plugins[k]
        else wrong(`plugins.${k}`)
      }
      out.values.plugins = plugins
    }
  }
  if (!isLocal) {
    if (has(data, 'arch')) {
      if (!isObject(data.arch)) {
        wrong('arch')
      } else {
        /** @type {Record<string, unknown>} */
        const arch = {}
        if (has(data.arch, 'ignore')) {
          const ig = data.arch.ignore
          if (Array.isArray(ig) && ig.every(isIgnoreEntry)) {
            arch.ignore = ig.map((e) => (typeof e === 'string' ? e : { path: e.path, reason: e.reason }))
          } else {
            wrong('arch.ignore')
          }
        }
        if (has(data.arch, 'git')) {
          if (typeof data.arch.git === 'boolean') arch.git = data.arch.git
          else wrong('arch.git')
        }
        out.values.arch = arch
      }
    }
    if (has(data, 'units')) {
      if (Array.isArray(data.units)) out.values.units = data.units
      else wrong('units')
    }
    if (has(data, 'root')) {
      if (isRootName(data.root)) out.values.root = data.root
      else wrong('root')
    }
    if (has(data, 'roots')) out.lines.push(`roots is read from ${LOCAL_SETTINGS_FILE} only`)
  } else {
    for (const k of ['arch', 'units']) {
      if (has(data, k)) out.lines.push(`${k} is read from .conport.json only`)
    }
    if (has(data, 'root')) out.lines.push(`remove root from ${LOCAL_SETTINGS_FILE} — the root is set by ${SETTINGS_FILE}`)
    if (has(data, 'roots')) {
      const roots = readRoots(data.roots)
      if (roots) out.values.roots = roots
      else wrong('roots')
    }
  }
  return out
}

/** @param {Record<string, unknown> | null | undefined} env */
function envName(env) {
  const v = env && env.CONPORT_PROJECT_NAME
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * The rules with one more answer: `blocked`, set when a file is there but broken, so that no
 * source named after the files may stand in for it.
 * @param {SettingsInput} input
 * @returns {Resolved & {blocked: boolean}}
 */
export function resolveSettingsVerdict(input) {
  const shared = readFile(SETTINGS_FILE, input.shared, false)
  const local = readFile(LOCAL_SETTINGS_FILE, input.local, true)
  /** @type {string[]} */
  const lines = []
  for (const f of [shared, local]) if (f.readError) lines.push(f.readError)
  lines.push(...shared.lines, ...local.lines)
  if (input.local !== null && input.local !== undefined && input.localIgnored === false) {
    lines.push(`${LOCAL_SETTINGS_FILE} is not ignored by git: add it to .gitignore`)
  }

  const plugins = { ...(shared.values.plugins || {}), ...(local.values.plugins || {}) }
  /** @type {Settings} */
  const settings = { plugins, arch: { ...(shared.values.arch || {}) } }
  if (shared.values.units) settings.units = shared.values.units
  if (shared.values.root !== undefined) settings.root = shared.values.root
  if (local.values.roots) settings.roots = local.values.roots

  /** @type {string | null} */
  let project = null
  /** @type {string | null} */
  let source = null
  const blocked = shared.blocks || local.blocks
  const explicit = typeof input.explicit === 'string' && input.explicit.trim() ? input.explicit.trim() : null
  const variable = envName(input.env)
  if (explicit) {
    project = explicit
    source = 'explicit'
  } else {
    if (local.name !== null) {
      project = local.name
      source = LOCAL_SETTINGS_FILE
      if (shared.name !== null && shared.name !== local.name) {
        lines.push(`project_name from ${LOCAL_SETTINGS_FILE} (${local.name}) overrides ${SETTINGS_FILE} (${shared.name})`)
      }
    } else if (shared.name !== null) {
      project = shared.name
      source = SETTINGS_FILE
    }
    if (blocked) {
      // A broken file, either one, names no project: neither the other file nor the variable
      // stands in for what it may have named.
      project = null
      source = null
    } else if (project !== null) {
      if (variable !== null && variable !== project) {
        lines.push(`CONPORT_PROJECT_NAME is ignored: ${source} names ${project} — remove the variable`)
      }
    } else if (variable !== null) {
      project = variable
      source = 'CONPORT_PROJECT_NAME'
    }
  }
  return { project, source, settings, lines, blocked }
}

/**
 * The settings and the project from the two files, the environment and an explicit argument.
 * The project comes from the explicit argument, then from project_name of the merged files (the
 * personal file over the shared one), then from CONPORT_PROJECT_NAME when no file names one. A
 * file that exists but is broken (unreadable, not JSON, not an object, a bad project_name) names
 * no project, and neither the other file nor the variable stands in for it.
 * @param {SettingsInput} input
 * @returns {Resolved}
 */
export function resolveSettings(input) {
  const { blocked: _blocked, ...resolved } = resolveSettingsVerdict(input)
  return resolved
}
