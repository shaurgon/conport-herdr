// The ConPort mod of Herdr: a panel that shows the work of a ConPort project by SDD stage and
// starts it. The projects are the git repositories the spaces of this machine stand in; four
// sections list the epics In work, the specs waiting for their plan, the ideas and proposals not
// worked through, and the epics outside SDD; the screen of an epic chooses its harness and the
// subagent type of each role and starts its lead session; a sheet opens an agent on an idea, a
// proposal, a spec or a task, or declines a proposal. The list is read in full when the mod opens,
// on Refresh, after a start of its own and every 10 minutes; every minute the light read of the
// taken rows marks them and asks for the full read when the set changed. Herdr redraws the mod
// when its live data changes; a folder the spaces reach after the last read is asked of git then.
import { div, View } from 'gpui-kit'
import { h_flex, InputState, Scrollbar, v_flex } from 'gpui-base'
import { agents, exec, focused, home, knownAgents, panes, readTextFile, run, setShared, shared, spaces, theme } from 'herdr'
import {
  projectGetArgs,
  readEpicTasks,
  rejectionText,
  runCli,
  sddSections,
  subagentsArgs,
  taskCounts,
  taskCountsLine
} from './cli.js'
import { epicWorktreePath } from './git.js'
import { DEFAULT_ROLES, harnessChoices } from './harness.js'
import { acceptProposal, declineProposal, handToAgent, readPlace, startEpic, startIdea, startSpec } from './launch.js'
import {
  askGitDirs,
  bindingParts,
  followNeeded,
  followSpaces,
  mergeProjects,
  pickProject,
  projectBinding,
  readBindingTexts,
  readConfigHome,
  settleFollow,
  spaceFolders
} from './projects.js'
import { ListReader } from './reader.js'
import { refusalLine, thrownRefusal } from './refusals.js'
import {
  documentUrl,
  epicState,
  epicTaskRow,
  FIXER_NOTE,
  handNotice,
  harnessLabel,
  NO_AGENT,
  NO_MILESTONE,
  POLL_TAKEN_MS,
  releaseLine,
  RESTART_NOTE,
  ROLE_KEYS,
  ROLE_TITLES,
  roleChoice,
  roleLists,
  rowActions,
  rowLine,
  rowTaken,
  SECTIONS,
  sectionLabel,
  sectionsOpen,
  SHEET_STEPS,
  sheetAgent,
  sheetText,
  skippedLine,
  startNotice,
  startView,
  TAKE_OVER_CONFIRM,
  takenMap,
  TYPE_MISSING_NOTE
} from './screen.js'
import { endSeenHolds, epicSession, HOLD_MS, releaseHold, rowSession, showTerminalCommands, startHold } from './session.js'
import { agentKey, bindingKey, chosenFor } from './state.js'
import { parts } from './ui.js'
import { CLI_VERSION, MOD_VERSION } from './version.js'

/** @import { AsyncContext, Context, Element } from 'gpui-kit' */
/** @import { EpicTask, HandRow, InWorkRow, ProposalRow, SddList, SddSections, SpecRow } from './cli.js' */
/** @import { Place } from './git.js' */
/** @import { KnownAgent, RoleKey, Roles } from './harness.js' */
/** @import { Binding, GitDirAnswer, Project } from './projects.js' */
/** @import { Ok, Refusal, Result } from './refusals.js' */
/** @import { ActionRow, SectionKey, Sheet, Subagents } from './screen.js' */
/** @import { Session } from './session.js' */
/** @import { HoldEntry } from './session.js' */
/** @import { Parts, Theme } from './ui.js' */

/**
 * What is chosen for an epic: its harness and the subagent type of each role.
 * @typedef {{harness: string, roles: Roles}} Choice
 */

/**
 * A Take over waiting for the person's yes: the title of the row and what a yes starts.
 * @typedef {{title: string, go: (cx: Context) => void}} TakeOver
 */

/**
 * What a press of a button of a row does, by the word of the button.
 * @typedef {Partial<Record<string, (cx: Context) => void>>} RowHandlers
 */

/** What a section says when it holds no row. */
const EMPTY = {
  in_work: 'No epic has a spec and a plan.',
  specs: 'No spec waits for its plan.',
  ideas: 'No idea or proposal waits.',
  outside: 'No epic is outside SDD.'
}

/** The buttons that open an agent: off while no agent that takes a task is installed. */
const AGENT_BUTTONS = new Set(['Brainstorm', 'Plan & build', 'Take over', 'Hand to agent', 'Review', 'Fix'])

/**
 * A value this copy of the mod keeps for the person (its tab, its project): none when storage fails.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
function stored(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // The value is a convenience: the mod works without it.
  }
}

const unique = (/** @type {string[]} */ list) => [...new Set(list)]

export default class ConportMod extends View {
  /**
   * @param {unknown} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    this.search = InputState.new({ placeholder: 'Find project' })
    this.reason = InputState.new({ placeholder: 'why the proposal is declined' })
    this.reason.on('submit', (_event, cx) => this.submitSheet(cx))
    this.search.on('change', (_event, cx) => cx.notify())
    this.bindDraft = InputState.new({ placeholder: 'name or handle' })
    this.bindDraft.on('submit', (_event, cx) => this.rememberProject(cx))

    /**
     * What git said of each folder of the spaces (`gitDirOf`): its absolute git directory, null
     * for one outside git, `{failed}` for one git failed on.
     * @type {Record<string, GitDirAnswer>}
     */
    this.gitDirs = {}
    this.reading = true
    /**
     * What Herdr answered for `knownAgents()`, null while it is asked.
     * @type {Result<KnownAgent[]> | null}
     */
    this.known = null
    /** @type {string | null} */
    this.chosen = stored('conport.project', null)
    // The project chosen before the window restarted, or picked by hand since: the last choice of a
    // catch-up (`followFolders`), which the full read may already have replaced in `chosen`.
    /** @type {string | null} */
    this.lastChosen = this.chosen
    this.pickedByHand = false
    this.pickerOpen = false
    /** @type {Binding | null} */
    this.binding = null
    // The context of the view: what a read that ends redraws, whichever call started it.
    this.view = cx
    /**
     * The reads of the stages: the full list, the light read of the taken rows, and when each runs.
     * @type {ListReader}
     */
    this.reader = new ListReader({
      run: (args, cwd) => runCli(exec, args, cwd),
      now: () => Date.now(),
      target: () => {
        const project = this.current()
        const handle = this.binding?.project ?? null
        return project === null || handle === null ? null : { project: handle, root: project.root }
      },
      changed: (full) => this.listChanged(full)
    })
    /** @type {{list: SddList, sections: SddSections} | null} */
    this.sectionsOf = null
    // What the storage holds is checked against the sections before it is used.
    /** @type {Record<SectionKey, boolean>} */
    this.open = sectionsOpen(stored('conport.sections', null))
    /**
     * The project's address `<team>/<name>`, read on the first Open spec of the project.
     * @type {string | null}
     */
    this.canonical = null
    /**
     * The epic open in each project, by its git directory.
     * @type {Record<string, number>}
     */
    this.opened = stored('conport.epics', {})
    /** @type {Result<Place> | null} */
    this.place = null
    /** @type {Result<EpicTask[]> | null} */
    this.epicTasks = null
    /**
     * The subagent types of each harness, read once per opening of an epic.
     * @type {Record<string, Result<Subagents>>}
     */
    this.subagents = {}
    /**
     * What the person chose for an epic and no start sent yet, by `<git dir>:<epic>`.
     * @type {Record<string, Choice>}
     */
    this.choices = {}
    /** @type {RoleKey | null} */
    this.expanded = null
    /** @type {Sheet | null} */
    this.sheet = null
    /** @type {TakeOver | null} */
    this.takeOver = null
    /** @type {string | null} */
    this.sheetAgent = null
    this.confirmAgain = false
    this.busy = false
    /** @type {Refusal | null} */
    this.refusal = null
    /** @type {string | null} */
    this.notice = null
    /**
     * The wait of Start after a start, by `<git dir>:<epic>`: `{ hold, task, worktree }` —
     * the hold, its one-off timer and the copy whose session ends it.
     * @type {Record<string, HoldEntry>}
     */
    this.holds = {}
    this.projectLoad = 0
    // The git directory of the project `loadProject` last read, null for none; whether git is
    // being asked about folders the spaces reached after the last read (`followFolders`).
    /** @type {string | null} */
    this.loadedFor = null
    this.following = false
    this.epicLoad = 0
    this.refresh(cx)
    // The light read every minute, while the view of the mod lives: the timer is the view's.
    cx.timer.every(POLL_TAKEN_MS, (cx) => {
      if (!this.reading) cx.spawn(async () => this.reader.tick())
    })
  }

  // --- reading ---------------------------------------------------------------------------------

  /**
   * Refresh: every read again; a wait after a start ends.
   * @param {Context} cx
   */
  refresh(cx) {
    for (const [key, entry] of Object.entries(this.holds)) {
      entry.task?.cancel()
      if (releaseHold(entry.hold, 'refresh') === null) delete this.holds[key]
    }
    cx.spawn(async (cx) => this.load(cx))
  }

  /** @param {AsyncContext} cx */
  async load(cx) {
    this.reading = true
    this.refusal = null
    this.notice = null
    this.known = null
    cx.notify()
    const folders = unique(spaceFolders(spaces(), panes()).flatMap((space) => space.folders))
    this.gitDirs = await askGitDirs(folders, { exec, read: readTextFile })
    try {
      this.known = { ok: true, data: await knownAgents() }
    } catch (error) {
      this.known = {
        ok: false,
        error: { code: 'agents_unknown', fact: `Herdr did not say which agents are installed: ${rejectionText(error)}`, action: 'press Refresh.' }
      }
    }
    const { projects } = this.projectList()
    const kept = this.pickedByHand && projects.some((project) => project.gitDir === this.chosen) ? this.chosen : null
    this.chosen = kept ?? pickProject(projects, { focusedSpace: focused()?.space ?? null, last: this.chosen })
    if (this.chosen !== null) store('conport.project', this.chosen)
    this.reading = false
    await this.loadProject(cx)
  }

  /**
   * Asks git about the folders the spaces reached since the last read, when there are any: after
   * a restart the panes report their live folders only after the mod read the folders the spaces
   * started in. The project is chosen by the rule of the full read and read when it differs from
   * the one read last (`settleFollow`). Herdr redraws the mod when the spaces change; the redraw
   * calls this.
   */
  followFolders() {
    const now = spaceFolders(spaces(), panes())
    if (!followNeeded(this, now, this.gitDirs)) return
    this.following = true
    this.view.spawn(async (cx) => {
      const started = { gitDirs: this.gitDirs, chosen: this.chosen }
      let answer = null
      try {
        answer = await followSpaces(now, started.gitDirs, {
          exec,
          read: readTextFile,
          chosen: started.chosen,
          byHand: this.pickedByHand,
          last: this.lastChosen ?? started.chosen,
          focusedSpace: focused()?.space ?? null
        })
      } finally {
        this.following = false
      }
      const kept = settleFollow(answer, started, this)
      if (kept === null) return
      this.gitDirs = kept.gitDirs
      this.chosen = kept.chosen
      if (kept.remember) store('conport.project', kept.chosen)
      if (kept.load) await this.loadProject(cx)
      else cx.notify()
    })
  }

  /** The projects and the folders without git of the spaces of this machine, as last read. */
  projectList() {
    return mergeProjects(spaceFolders(spaces(), panes()), this.gitDirs)
  }

  /** @returns {Project | null} */
  current() {
    return this.projectList().projects.find((project) => project.gitDir === this.chosen) ?? null
  }

  /**
   * The handle of the project, as the CLI answered it.
   * @returns {string | null}
   */
  handle() {
    const list = this.reader.list
    return list?.ok ? (list.data.project ?? this.binding?.project ?? null) : null
  }

  /** @param {AsyncContext} cx */
  async loadProject(cx) {
    const mine = ++this.projectLoad
    this.epicLoad++
    this.binding = null
    this.reader.reset()
    this.canonical = null
    this.place = null
    this.epicTasks = null
    this.subagents = {}
    this.sheet = null
    this.takeOver = null
    this.confirmAgain = false
    this.expanded = null
    cx.notify()
    const project = this.current()
    this.loadedFor = project?.gitDir ?? null
    if (project === null) return
    const texts = await readBindingTexts({
      read: readTextFile,
      exec,
      gitDir: project.gitDir,
      home: home(),
      configHome: await readConfigHome(exec)
    })
    if (mine !== this.projectLoad) return
    this.binding = projectBinding(texts, shared(bindingKey(project.gitDir)))
    cx.notify()
    if (this.binding.project === null) return
    await this.reader.read('full')
  }

  /**
   * The full read after a start of the mod's own: the row it started is taken now.
   * @param {Context} cx
   */
  readAfterStart(cx) {
    cx.spawn(async () => this.reader.read('full'))
  }

  /**
   * A read changed what is shown: redraw; after a full read, the open epic closes when it is no
   * longer In work, and is read when it was opened before the list came.
   * @param {boolean} full
   */
  listChanged(full) {
    const project = this.current()
    if (full && project !== null) {
      if (this.opened[project.gitDir] !== undefined && this.openedEpic() === null) this.setOpened(null)
      else if (this.openedEpic() !== null && this.place === null && this.epicTasks === null) this.view.spawn(async (cx) => this.loadEpic(cx))
    }
    this.view.notify()
  }

  /**
   * The four sections of the last full read; the same object while the list is the same.
   * @returns {SddSections | null}
   */
  sections() {
    const list = this.reader.list
    if (!list?.ok) return null
    if (this.sectionsOf?.list !== list.data) this.sectionsOf = { list: list.data, sections: sddSections(list.data) }
    return this.sectionsOf.sections
  }

  /**
   * The epic open in the chosen project, while it is In work and can run.
   * @returns {InWorkRow | null}
   */
  openedEpic() {
    const project = this.current()
    const sections = this.sections()
    if (project === null || sections === null) return null
    const id = this.opened[project.gitDir]
    return sections.inWork.flatMap((group) => group.epics).find((epic) => epic.id === id && !epic.reason) ?? null
  }

  /** @param {number | null} epic */
  setOpened(epic) {
    const project = this.current()
    if (project === null) return
    const { [project.gitDir]: _dropped, ...others } = this.opened
    this.opened = epic === null ? others : { ...others, [project.gitDir]: epic }
    store('conport.epics', this.opened)
  }

  /**
   * Reads the open epic: where it runs, its tasks, and the subagent types of its harness.
   * @param {AsyncContext} cx
   */
  async loadEpic(cx) {
    const mine = ++this.epicLoad
    this.place = null
    this.epicTasks = null
    this.subagents = {}
    this.confirmAgain = false
    this.expanded = null
    cx.notify()
    const project = this.current()
    const epic = this.openedEpic()
    const handle = this.handle()
    if (project === null || epic === null || handle === null) return
    const [place, list] = await Promise.all([
      readPlace(exec, { folder: project.root, epic: epic.id, home: home() }),
      readEpicTasks(exec, { epic: epic.id, project: handle, root: project.root })
    ])
    if (mine !== this.epicLoad) return
    this.place = place
    this.epicTasks = list
    cx.notify()
    await this.loadSubagents(cx, this.choice().harness)
  }

  /**
   * @param {AsyncContext} cx
   * @param {string} harness
   */
  async loadSubagents(cx, harness) {
    if (this.subagents[harness] !== undefined) return
    if (!this.harnesses().find((choice) => choice.kind === harness)?.installed) return
    const project = this.current()
    if (project === null) return
    const mine = this.epicLoad
    const answer = await runCli(exec, subagentsArgs(harness), project.root)
    if (mine !== this.epicLoad) return
    this.subagents = { ...this.subagents, [harness]: answer }
    cx.notify()
  }

  // --- choices -----------------------------------------------------------------------------------

  harnesses() {
    return harnessChoices(this.known?.ok ? this.known.data : [])
  }

  epicChoiceKey() {
    const project = this.current()
    const epic = this.openedEpic()
    return project === null || epic === null ? null : `${project.gitDir}:${epic.id}`
  }

  /**
   * What is chosen for the open epic: the person's choice not yet started, else what is remembered.
   * @returns {Choice | null}
   */
  choice() {
    const key = this.epicChoiceKey()
    if (key === null) return null
    return this.choices[key] ?? chosenFor(shared, this.current().gitDir, this.openedEpic().id)
  }

  /** @param {Partial<Choice>} patch */
  choose(patch) {
    const key = this.epicChoiceKey()
    if (key === null) return
    this.choices = { ...this.choices, [key]: { ...this.choice(), ...patch } }
  }

  lists() {
    const choice = this.choice()
    if (choice === null) return null
    const installed = this.harnesses().find((h) => h.kind === choice.harness)?.installed === true
    return roleLists({ installed, answer: this.subagents[choice.harness], roles: choice.roles })
  }

  /**
   * The live session of the copy `worktree`, from Herdr's live data.
   * @param {string} worktree
   */
  copySession(worktree) {
    return epicSession({ agents: agents(), panes: panes(), spaces: spaces(), worktree })
  }

  /** The live session of the open epic, from Herdr's live data. */
  session() {
    if (!this.place?.ok) return { live: false, space: null }
    return this.copySession(this.place.data.worktree)
  }

  // --- actions -----------------------------------------------------------------------------------

  /**
   * @param {Context} cx
   * @param {string} gitDir
   */
  chooseProject(cx, gitDir) {
    this.pickerOpen = false
    this.search.set_value('')
    if (gitDir === this.chosen) return cx.notify()
    this.chosen = gitDir
    this.lastChosen = gitDir
    this.pickedByHand = true
    store('conport.project', gitDir)
    this.notice = null
    this.refusal = null
    cx.spawn(async (cx) => this.loadProject(cx))
  }

  /** @param {Context} cx */
  rememberProject(cx) {
    const project = this.current()
    const value = this.bindDraft.value().trim()
    if (project === null || value === '') return
    setShared(bindingKey(project.gitDir), value)
    this.bindDraft.set_value('')
    cx.spawn(async (cx) => this.loadProject(cx))
  }

  /** @param {Context} cx */
  forgetProject(cx) {
    const project = this.current()
    if (project === null) return
    this.pickerOpen = false
    setShared(bindingKey(project.gitDir), null)
    cx.spawn(async (cx) => this.loadProject(cx))
  }

  /**
   * Folds or opens a section; the mod keeps it for the person.
   * @param {Context} cx
   * @param {SectionKey} key
   */
  toggleSection(cx, key) {
    this.open = { ...this.open, [key]: !this.open[key] }
    store('conport.sections', this.open)
    cx.notify()
  }

  /**
   * Asks before a Take over: another session may be at the row.
   * @param {Context} cx
   * @param {string} title
   * @param {(cx: Context) => void} go
   */
  askTakeOver(cx, title, go) {
    this.takeOver = { title, go }
    this.notice = null
    this.refusal = null
    cx.notify()
  }

  /**
   * Brings the terminal of a row forward: its space, then its tab in that space.
   * @param {Session} session
   */
  showTerminal(session) {
    for (const [name, args] of showTerminalCommands(session)) run(name, args)
  }

  /**
   * The first live agent among the tabs `names` a start of this host opened in the root.
   * @param {(string | null)[]} names
   * @returns {Session}
   */
  tabSession(names) {
    for (const tab of names) {
      if (tab === null) continue
      const session = rowSession({ agents: agents(), spaces: spaces(), tab })
      if (session.live) return session
    }
    return { live: false, space: null }
  }

  /**
   * The terminal of an epic In work on this host: its lead session in its copy, else the tab that
   * planned it, the tab of its spec or of its idea — an epic made from them inherits their terminal.
   * @param {InWorkRow} epic
   * @returns {Session}
   */
  epicTerminal(epic) {
    const project = this.current()
    if (project !== null) {
      const lead = this.copySession(epicWorktreePath(home(), project.root, epic.id))
      if (lead.live) return lead
    }
    return this.tabSession([`plan-${epic.id}`, epic.spec ? `doc-${epic.spec}` : null, epic.idea ? `idea-${epic.idea}` : null])
  }

  /**
   * The terminal of a spec on this host: the tab of its document, or the tab that plans its epic.
   * @param {SpecRow} spec
   * @returns {Session}
   */
  specTerminal(spec) {
    return this.tabSession([`doc-${spec.doc}`, spec.epic ? `plan-${spec.epic}` : null, spec.idea ? `idea-${spec.idea}` : null])
  }

  /**
   * Open spec: the document in the dashboard, in the team of the project, which the CLI tells once.
   * @param {Context} cx
   * @param {number} doc
   */
  openSpec(cx, doc) {
    const project = this.current()
    const handle = this.handle()
    if (project === null || handle === null) return
    const mine = this.projectLoad
    this.refusal = null
    cx.spawn(async (cx) => {
      if (this.canonical === null) {
        const answer = await runCli(exec, projectGetArgs(handle), project.root)
        if (mine !== this.projectLoad) return
        if (answer.ok === false) {
          this.refusal = answer.error
          cx.notify()
          return
        }
        this.canonical = typeof answer.data?.canonical_name === 'string' ? answer.data.canonical_name : null
      }
      const url = documentUrl({ canonical: this.canonical, handle, doc })
      if (url === null) {
        this.refusal = { code: 'bad_output', fact: 'the CLI answered no team of the project', action: '' }
        cx.notify()
        return
      }
      cx.open_url(url)
    })
  }

  /**
   * @param {Context} cx
   * @param {number} epic
   */
  openEpic(cx, epic) {
    this.setOpened(epic)
    this.notice = null
    this.refusal = null
    cx.spawn(async (cx) => this.loadEpic(cx))
  }

  /** @param {Context} cx */
  closeEpic(cx) {
    this.setOpened(null)
    this.epicLoad++
    this.place = null
    this.epicTasks = null
    this.confirmAgain = false
    this.notice = null
    this.refusal = null
    cx.notify()
  }

  /**
   * @param {Context} cx
   * @param {string} harness
   */
  chooseHarness(cx, harness) {
    // Another harness has other subagents: the roles go back to the default types.
    this.choose({ harness, roles: { ...DEFAULT_ROLES } })
    this.expanded = null
    cx.spawn(async (cx) => this.loadSubagents(cx, harness))
    cx.notify()
  }

  /**
   * @param {Context} cx
   * @param {RoleKey} key
   * @param {string} type
   */
  chooseRole(cx, key, type) {
    const lists = this.lists()
    if (lists === null) return
    this.choose({ roles: { ...lists.roles, [key]: type } })
    this.expanded = null
    cx.notify()
  }

  /**
   * Starts the open epic as chosen; the start is off until its session appears or a minute passes.
   * @param {Context} cx
   */
  start(cx) {
    const project = this.current()
    const epic = this.openedEpic()
    const handle = this.handle()
    const choice = this.choice()
    const lists = this.lists()
    if (this.busy || project === null || epic === null || handle === null || lists === null || !this.known?.ok) return
    this.busy = true
    this.refusal = null
    this.notice = null
    this.confirmAgain = false
    const key = `${project.gitDir}:${epic.id}`
    cx.spawn(async (cx) => {
      try {
        const answer = await startEpic(
          { exec, run, setShared, home: home(), spaces, panes, agents },
          {
            epic: epic.id,
            project: handle,
            harness: choice.harness,
            roles: lists.roles,
            folder: project.root,
            gitDir: project.gitDir,
            // Read as the guard above found it: a start runs only once Herdr named its agents.
            knownAgents: /** @type {Ok<KnownAgent[]>} */ (this.known).data
          }
        )
        if (answer.ok === false) {
          this.refusal = answer.error
          return
        }
        const { [key]: _sent, ...others } = this.choices
        this.choices = others
        if (this.epicChoiceKey() === key) {
          this.notice = startNotice(epic.id)
          this.place = { ok: true, data: { root: project.root, base: answer.data.base, worktree: answer.data.worktree, copy: 'existing' } }
        }
        this.hold(cx, key, epic.id, answer.data.worktree)
        this.readAfterStart(cx)
      } catch (error) {
        this.refusal = thrownRefusal(error)
      } finally {
        this.busy = false
        cx.notify()
      }
    })
    cx.notify()
  }

  /**
   * The wait of Start after a start. It ends when the session of the copy is seen (`render`
   * calls `endSeenHolds` on every redraw); its one-off timer ends it — at once when the session
   * is live by then, else with the line that the agent was not seen. Refresh ends it too.
   * @param {Context} cx
   * @param {string} key
   * @param {number} epic
   * @param {string} worktree
   */
  hold(cx, key, epic, worktree) {
    this.holds[key]?.task?.cancel()
    /** @type {HoldEntry} */
    const entry = { hold: startHold(epic), task: null, worktree }
    entry.task = cx.timer.after(HOLD_MS, (cx) => {
      if (this.holds[key] !== entry) return
      const live = this.copySession(worktree).live
      entry.hold = releaseHold(entry.hold, live ? 'session' : 'timer')
      if (entry.hold === null) delete this.holds[key]
      cx.notify()
    })
    this.holds[key] = entry
  }

  /**
   * @param {Context} cx
   * @param {Sheet} sheet
   */
  openSheet(cx, sheet) {
    const project = this.current()
    if (project === null) return
    this.sheet = sheet
    this.takeOver = null
    this.sheetAgent = sheetAgent(this.harnesses(), shared(agentKey(project.gitDir)))
    if (sheet.kind === 'decline') this.reason.set_value('')
    this.notice = null
    this.refusal = null
    cx.notify()
  }

  /**
   * The sheet's work: a decline sends the reason; any other opens the chosen agent in a tab of the
   * project root with the task the CLI gave — a proposal is accepted first and its idea opened.
   * Then the list is read in full.
   * @param {Context} cx
   */
  submitSheet(cx) {
    const open = this.sheet
    const agent = this.sheetAgent
    const project = this.current()
    const handle = this.handle()
    if (this.busy || open === null || project === null || handle === null) return
    const decline = open.kind === 'decline'
    if (!decline && (agent === null || !this.known?.ok)) return
    this.busy = true
    this.refusal = null
    cx.spawn(async (cx) => {
      let changed = false
      try {
        if (open.kind === 'decline') {
          const answer = await declineProposal({ exec }, { doc: open.proposal.doc, project: handle, root: project.root, reason: this.reason.value() })
          if (answer.ok === false) this.refusal = answer.error
          else {
            changed = true
            this.sheet = null
            this.notice = handNotice({ kind: 'decline', id: open.proposal.doc, tab: null, project: project.name })
          }
          return
        }
        const deps = { exec, run, setShared, spaces, panes }
        // Read as the guard above found it: a sheet opens an agent only once Herdr named them.
        const base = { agent, project: handle, root: project.root, gitDir: project.gitDir, knownAgents: /** @type {Ok<KnownAgent[]>} */ (this.known).data }
        /** @type {number} */
        let id
        /** @type {Result<{name: string}>} */
        let answer
        if (open.kind === 'idea') {
          id = open.idea.id
          answer = await startIdea(deps, { ...base, task: id })
        } else if (open.kind === 'proposal') {
          const accepted = await acceptProposal({ exec }, { doc: open.proposal.doc, project: handle, root: project.root })
          if (accepted.ok === false) {
            this.refusal = accepted.error
            return
          }
          // The proposal is an idea now, whatever the start answers.
          changed = true
          id = accepted.data.task
          answer = await startIdea(deps, { ...base, task: id })
        } else if (open.kind === 'spec') {
          const { doc, epic } = open.spec
          id = epic ?? doc
          answer = await startSpec(deps, { ...base, target: epic === null || epic === undefined ? { doc } : { epic } })
        } else {
          id = open.task.id
          answer = await handToAgent(deps, { ...base, kind: open.kind, id })
        }
        if (answer.ok === false) this.refusal = answer.error
        else {
          changed = true
          this.sheet = null
          this.notice = handNotice({ kind: open.kind, id, tab: answer.data.name, project: project.name })
        }
      } catch (error) {
        this.refusal = thrownRefusal(error)
      } finally {
        this.busy = false
        cx.notify()
        if (changed) this.readAfterStart(cx)
      }
    })
    cx.notify()
  }

  // --- drawing -----------------------------------------------------------------------------------

  render() {
    this.followFolders()
    // Herdr redraws the mod when its live data changes: a session seen ends the wait of its start.
    endSeenHolds(this.holds, (worktree) => this.copySession(worktree))
    const t = /** @type {Theme} */ (theme())
    const ui = parts(t)
    const project = this.current()
    return v_flex()
      .id('conport')
      .size_full()
      .bg(t.surface)
      .text_size(13)
      .text_color(t.foreground)
      .child(this.header(ui, project))
      .child(ui.rule())
      .child(
        div()
          .relative()
          .flex_1()
          .min_h(0)
          .child(v_flex().id('conport-body').size_full().overflow_y_scroll().p(10).gap(10).children(this.body(ui, project)))
          .child(Scrollbar.vertical('conport-body').absolute().inset_0())
      )
      .child(ui.rule())
      .child(h_flex().px(10).py(6).text_size(11).text_color(t.dim).child(`mod ${MOD_VERSION} · CLI ${CLI_VERSION}`))
  }

  /**
   * @param {Parts} ui
   * @param {Project | null} project
   */
  header(ui, project) {
    const { t } = ui
    const open = this.pickerOpen || (project === null && !this.reading)
    const note = project === null ? 'No project chosen' : this.bindingNote()
    const top = h_flex()
      .gap(8)
      .items_center()
      .child(
        v_flex()
          .id('project-title')
          .flex_1()
          .min_w(0)
          .cursor_pointer()
          .on_click((_event, cx) => {
            this.pickerOpen = !this.pickerOpen
            cx.notify()
          })
          .child(div().truncate().font_semibold().child(`${project?.name ?? 'Choose a project'} ${open ? '▴' : '▾'}`))
          .child(div().truncate().text_size(11).text_color(t.dim).child(note))
      )
      .child(ui.button('refresh', 'Refresh', { disabled: this.busy || this.reading, onClick: (_event, cx) => this.refresh(cx) }))
    return v_flex()
      .p(10)
      .gap(8)
      .child(top)
      .when(open, (el) => el.child(this.picker(ui)))
  }

  bindingNote() {
    if (this.binding === null) return 'Loading the ConPort project…'
    if (this.binding.project === null) return 'No ConPort project'
    return `ConPort · ${this.handle() ?? this.binding.project}`
  }

  /** @param {Parts} ui */
  picker(ui) {
    const { projects, plain } = this.projectList()
    const query = this.search.value().trim().toLowerCase()
    const shown = projects.filter((project) => query === '' || `${project.name} ${project.root}`.toLowerCase().includes(query))
    const focus = focused()?.space ?? null
    const rows = shown.map((project) =>
      ui.row(`project-${project.gitDir}`, {
        title: project.name,
        line: project.spaces.includes(focus) ? `${ui.tilde(project.root)} · in focus` : ui.tilde(project.root),
        current: project.gitDir === this.chosen,
        onClick: (_event, cx) => this.chooseProject(cx, project.gitDir)
      })
    )
    const folders = plain.map((item) => ui.row(`folder-${item.folder}`, { title: ui.tilde(item.folder), line: item.reason, muted: true }))
    return v_flex()
      .gap(4)
      .child(ui.input(this.search))
      .when(this.reading, (el) => el.child(ui.dim('Loading projects…')))
      .when(!this.reading && projects.length === 0, (el) =>
        el.child(ui.dim('No space on this machine is in a git repository — open a space in a repository and press Refresh.'))
      )
      .when(!this.reading && projects.length > 0 && shown.length === 0, (el) => el.child(ui.dim('No project matches.')))
      .children(rows)
      .children(folders)
      .when(this.binding?.source === 'stored', (el) =>
        el.child(h_flex().child(ui.button('forget', 'Change ConPort project', { quiet: true, onClick: (_event, cx) => this.forgetProject(cx) })))
      )
  }

  /**
   * @param {Parts} ui
   * @param {Project | null} project
   * @returns {Element[]}
   */
  body(ui, project) {
    /** @type {Element[]} */
    const out = []
    if (this.refusal) out.push(ui.refusal(this.refusal))
    if (this.notice) out.push(ui.notice(this.notice))
    if (this.known && this.known.ok === false) out.push(ui.refusal(this.known.error))
    if (this.reader.listError) out.push(ui.refusal(this.reader.listError))
    if (this.reading || project === null) return out
    if (this.binding === null) return [...out, ui.dim('Loading the ConPort project…')]
    const shown = bindingParts(this.binding)
    if (shown.settings) out.push(this.settingsCard(ui))
    if (shown.bind) return [...out, this.bindCard(ui, shown.bindNote)]
    if (!shown.lists) return out
    const list = this.reader.list
    if (list === null) return [...out, ui.dim('Loading the SDD stages…')]
    if (list.ok === false) return [...out, ui.refusal(list.error)]
    if (this.takeOver !== null) return [...out, this.takeOverCard(ui)]
    if (this.sheet !== null) return [...out, this.sheetCard(ui)]
    const epic = this.openedEpic()
    if (epic !== null) return [...out, ...this.epicScreen(ui, epic, project)]
    return [...out, ...this.agentsNote(ui), ...this.sectionsView(ui)]
  }

  /**
   * @param {Parts} ui
   * @param {string} note
   */
  bindCard(ui, note) {
    return ui.card([
      ui.title('ConPort project'),
      ui.text(refusalLine({ code: 'no_project' })),
      ui.dim(note),
      ui.input(this.bindDraft),
      h_flex().child(ui.button('bind', 'Remember', { primary: true, onClick: (_event, cx) => this.rememberProject(cx) }))
    ])
  }

  /**
   * What the ConPort settings files of the repository tell, drawn while the project is shown.
   * @param {Parts} ui
   */
  settingsCard(ui) {
    return ui.card([ui.title('ConPort settings'), ...this.binding.lines.map((line) => ui.text(line))])
  }

  /**
   * The four sections, each a header that folds or opens it, with its rows under it: drawn once
   * `body` found the list read.
   * @param {Parts} ui
   * @returns {Element[]}
   */
  sectionsView(ui) {
    const { t } = ui
    const sections = /** @type {SddSections} */ (this.sections())
    const taken = takenMap(this.reader.taken)
    const now = new Date()
    const epics = (/** @type {{epics: unknown[]}[]} */ groups) => groups.reduce((sum, group) => sum + group.epics.length, 0)
    /** @type {Record<SectionKey, number>} */
    const counts = {
      in_work: epics(sections.inWork),
      specs: sections.specs.length,
      ideas: sections.ideas.length,
      outside: epics(sections.outside)
    }
    /** @type {Record<SectionKey, () => Element[]>} */
    const rows = {
      in_work: () => this.inWorkRows(ui, sections, taken, now),
      specs: () => this.specRows(ui, sections, taken, now),
      ideas: () => this.ideaRows(ui, sections, taken, now),
      outside: () => this.outsideRows(ui, sections, taken, now)
    }
    return SECTIONS.map(({ key, caption }) => {
      const open = this.open[key]
      const head = h_flex()
        .id(`section-${key}`)
        .gap(6)
        .items_center()
        .cursor_pointer()
        .on_click((_event, cx) => this.toggleSection(cx, key))
        .child(div().w(10).text_color(t.dim).child(open ? '▾' : '▸'))
        .child(div().font_semibold().child(sectionLabel(key, counts[key])))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(caption))
      const body = counts[key] === 0 && key !== 'ideas' ? [ui.dim(EMPTY[key])] : rows[key]()
      return v_flex()
        .gap(4)
        .child(head)
        .when(open, (el) => el.children(body))
    })
  }

  /**
   * The buttons of a row, by the words `rowActions` gives: one that opens an agent is off while
   * none is installed or an action runs.
   * @param {Parts} ui
   * @param {string} id
   * @param {string[]} words
   * @param {RowHandlers} handlers
   * @returns {Element | null}
   */
  actions(ui, id, words, handlers) {
    if (words.length === 0) return null
    return h_flex()
      .gap(4)
      .children(
        words.map((word) =>
          ui.button(`${id}-${word}`, word, {
            disabled: this.busy || (AGENT_BUTTONS.has(word) && !this.canHand()),
            onClick: (_event, cx) => handlers[word]?.(cx)
          })
        )
      )
  }

  /**
   * A milestone's title, and its release line for a release milestone.
   * @param {Parts} ui
   * @param {{milestone: InWorkRow['milestone'], release: boolean}} group
   * @returns {Element[]}
   */
  milestoneHead(ui, group) {
    const head = [ui.label(group.milestone?.title ?? NO_MILESTONE)]
    if (group.release && group.milestone) head.push(ui.dim(releaseLine(group.milestone)))
    return head
  }

  /**
   * In work: the epics with a spec and a plan by milestone; a row opens the screen of its epic.
   * @param {Parts} ui
   * @param {SddSections} sections
   * @param {Map<number, string> | null} taken
   * @param {Date} now
   * @returns {Element[]}
   */
  inWorkRows(ui, sections, taken, now) {
    const { t } = ui
    return sections.inWork.map((group) =>
      v_flex()
        .gap(2)
        .children(this.milestoneHead(ui, group))
        .children(
          group.epics.map((epic) => {
            const isTaken = rowTaken(epic, taken)
            const terminal = this.epicTerminal(epic)
            /** @type {ActionRow} */
            const row = { type: 'epic', section: 'in_work', status: epic.status, reason: epic.reason, ready: epic.ready, progress: epic.progress }
            const open = (/** @type {Context} */ cx) => this.openEpic(cx, epic.id)
            return ui.row(`epic-${epic.id}`, {
              title: `${epic.id} · ${epic.title}`,
              line: rowLine(row, { taken: isTaken, updated: taken?.get(epic.id) ?? epic.updated_at, now }),
              lineColor: epic.ready ? t.done : undefined,
              muted: Boolean(epic.reason),
              onClick: epic.reason ? undefined : (_event, cx) => open(cx),
              action: this.actions(ui, `epic-${epic.id}`, rowActions(row, isTaken, terminal.live), {
                Start: open,
                'Show terminal': () => this.showTerminal(terminal),
                'Take over': (cx) => this.askTakeOver(cx, epic.title, open)
              })
            })
          })
        )
    )
  }

  /**
   * Specs: the spec documents waiting for their plan and the epics with a spec and no plan.
   * @param {Parts} ui
   * @param {SddSections} sections
   * @param {Map<number, string> | null} taken
   * @param {Date} now
   * @returns {Element[]}
   */
  specRows(ui, sections, taken, now) {
    return sections.specs.map((spec) => {
      const isTaken = rowTaken({ id: spec.epic, taken: spec.taken }, taken)
      const terminal = this.specTerminal(spec)
      /** @type {ActionRow} */
      const row = { type: 'spec', epic: spec.epic, priority: spec.priority }
      const plan = (/** @type {Context} */ cx) => this.openSheet(cx, { kind: 'spec', spec })
      const id = spec.epic === null || spec.epic === undefined ? `doc-${spec.doc}` : `${spec.epic}`
      return ui.row(`spec-${spec.doc}`, {
        title: `${id} · ${spec.title}`,
        line: rowLine(row, { taken: isTaken, updated: (spec.epic ? taken?.get(spec.epic) : null) ?? spec.updated_at, now }),
        action: this.actions(ui, `spec-${spec.doc}`, rowActions(row, isTaken, terminal.live), {
          'Plan & build': plan,
          'Show terminal': () => this.showTerminal(terminal),
          'Take over': (cx) => this.askTakeOver(cx, spec.title, plan),
          'Open spec': (cx) => this.openSpec(cx, spec.doc)
        })
      })
    })
  }

  /**
   * Ideas: the ideas and the proposals by priority, and how many proposals could not be read.
   * @param {Parts} ui
   * @param {SddSections} sections
   * @param {Map<number, string> | null} taken
   * @param {Date} now
   * @returns {Element[]}
   */
  ideaRows(ui, sections, taken, now) {
    /** @type {Element[]} */
    const out = sections.ideas.map((item) => {
      if ('doc' in item) {
        const proposal = /** @type {ProposalRow} */ (item)
        return ui.row(`proposal-${proposal.doc}`, {
          title: `doc-${proposal.doc} · ${proposal.title}`,
          line: rowLine({ type: 'proposal', author: proposal.author }, { taken: false }),
          action: this.actions(ui, `proposal-${proposal.doc}`, rowActions({ type: 'proposal' }, false, false), {
            Brainstorm: (cx) => this.openSheet(cx, { kind: 'proposal', proposal }),
            Decline: (cx) => this.openSheet(cx, { kind: 'decline', proposal })
          })
        })
      }
      const idea = /** @type {HandRow & {taken: boolean}} */ (item)
      const isTaken = rowTaken(idea, taken)
      const terminal = this.tabSession([`idea-${idea.id}`, `task-${idea.id}`])
      /** @type {ActionRow} */
      const row = { type: 'idea', status: idea.status, mode: idea.mode, kind: idea.kind, priority: idea.priority, changes_requested: idea.changes_requested }
      const brainstorm = (/** @type {Context} */ cx) => this.openSheet(cx, { kind: 'idea', idea })
      const hand = (/** @type {Context} */ cx) => idea.mode !== null && this.openSheet(cx, { kind: idea.mode, task: idea })
      return ui.row(`idea-${idea.id}`, {
        title: `${idea.id} · ${idea.title}`,
        line: rowLine(row, { taken: isTaken, updated: taken?.get(idea.id) ?? idea.updated_at, now }),
        action: this.actions(ui, `idea-${idea.id}`, rowActions(row, isTaken, terminal.live), {
          Brainstorm: brainstorm,
          Review: hand,
          Fix: hand,
          'Show terminal': () => this.showTerminal(terminal),
          'Take over': (cx) => this.askTakeOver(cx, idea.title, brainstorm)
        })
      })
    })
    if (out.length === 0) out.push(ui.dim(EMPTY.ideas))
    if (sections.skipped > 0) out.push(ui.dim(skippedLine(sections.skipped)))
    return out
  }

  /**
   * Outside SDD: the epics without a spec by milestone, each with its open tasks to hand to an agent.
   * @param {Parts} ui
   * @param {SddSections} sections
   * @param {Map<number, string> | null} taken
   * @param {Date} now
   * @returns {Element[]}
   */
  outsideRows(ui, sections, taken, now) {
    return sections.outside.map((group) =>
      v_flex()
        .gap(2)
        .children(this.milestoneHead(ui, group))
        .children(
          group.epics.map((epic) => {
            const isTaken = rowTaken(epic, taken)
            /** @type {ActionRow} */
            const row = { type: 'epic', section: 'outside', status: epic.status, progress: epic.progress }
            const tasks = epic.tasks.map((task) => {
              /** @type {ActionRow} */
              const line = { type: 'task', status: task.status, mode: task.mode, kind: task.kind, priority: task.priority, changes_requested: task.changes_requested }
              const hand = (/** @type {Context} */ cx) => task.mode !== null && this.openSheet(cx, { kind: task.mode, task })
              return ui.row(`task-${task.id}`, {
                title: `${task.id} · ${task.title}`,
                line: rowLine(line, { taken: false }),
                action: this.actions(ui, `task-${task.id}`, rowActions(line, false, false), { 'Hand to agent': hand, Review: hand, Fix: hand })
              })
            })
            return v_flex()
              .gap(2)
              .child(
                ui.row(`outside-${epic.id}`, {
                  title: `${epic.id} · ${epic.title}`,
                  line: rowLine(row, { taken: isTaken, updated: taken?.get(epic.id) ?? epic.updated_at, now })
                })
              )
              .child(v_flex().pl(16).gap(2).children(tasks))
          })
        )
    )
  }

  /**
   * Why no sheet can open: no agent that takes a task is installed.
   * @param {Parts} ui
   */
  agentsNote(ui) {
    return this.known?.ok && !this.harnesses().some((choice) => choice.installed) ? [ui.dim(NO_AGENT)] : []
  }

  canHand() {
    return !this.busy && this.known?.ok === true && this.harnesses().some((choice) => choice.installed)
  }

  /**
   * Take over asks first: another session may be at the row.
   * @param {Parts} ui
   */
  takeOverCard(ui) {
    const { title, go } = /** @type {TakeOver} */ (this.takeOver)
    return ui.card([
      ui.title(`Take over “${title}”?`),
      ui.text(TAKE_OVER_CONFIRM),
      h_flex()
        .gap(6)
        .justify_end()
        .child(
          ui.button('take-over-no', 'Cancel', {
            quiet: true,
            onClick: (_event, cx) => {
              this.takeOver = null
              cx.notify()
            }
          })
        )
        .child(
          ui.button('take-over-yes', 'Take over', {
            primary: true,
            onClick: (_event, cx) => {
              this.takeOver = null
              go(cx)
              cx.notify()
            }
          })
        )
    ])
  }

  /** @param {Parts} ui */
  sheetCard(ui) {
    const open = this.sheet
    const text = sheetText(open)
    const decline = open.kind === 'decline'
    const installed = this.harnesses().filter((choice) => choice.installed)
    const last = shared(agentKey(this.current()?.gitDir ?? ''))
    const who = decline
      ? ui.input(this.reason)
      : installed.length === 0
      ? ui.dim(NO_AGENT)
      : h_flex()
          .gap(4)
          .flex_wrap()
          .children(
            installed.map((choice) =>
              ui.chip(`agent-${choice.kind}`, choice.kind === last ? `${choice.label} · last time` : choice.label, {
                selected: this.sheetAgent === choice.kind,
                onClick: (_event, cx) => {
                  this.sheetAgent = choice.kind
                  cx.notify()
                }
              })
            )
          )
    return ui.card([
      ui.title(text.title),
      ui.dim(text.description),
      ...(decline ? [] : [ui.steps(SHEET_STEPS[/** @type {Exclude<Sheet['kind'], 'decline'>} */ (open.kind)])]),
      ui.label(text.who),
      who,
      h_flex()
        .gap(6)
        .justify_end()
        .child(
          ui.button('sheet-cancel', 'Cancel', {
            quiet: true,
            onClick: (_event, cx) => {
              this.sheet = null
              cx.notify()
            }
          })
        )
        .child(
          ui.button('sheet-go', text.button, {
            primary: true,
            disabled: this.busy || (!decline && this.sheetAgent === null),
            onClick: (_event, cx) => this.submitSheet(cx)
          })
        )
    ])
  }

  /**
   * @param {Parts} ui
   * @param {InWorkRow} epic
   * @param {Project} project
   */
  epicScreen(ui, epic, project) {
    const { t } = ui
    const kicker = epic.milestone ? `${epic.id} · ${epic.milestone.title}` : String(epic.id)
    const head = v_flex()
      .gap(4)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(ui.button('back', '← Sections', { quiet: true, onClick: (_event, cx) => this.closeEpic(cx) }))
          .child(div().truncate().text_size(11).text_color(t.dim).child(project.name))
      )
      .child(div().text_size(11).text_color(t.dim).child(kicker))
      .child(div().text_size(15).font_semibold().child(epic.title))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_wrap()
          .child(ui.badge('Spec ✓'))
          .child(ui.badge('Plan ✓'))
          .child(div().text_size(11).text_color(epic.ready ? t.done : t.dim).child(epicState(epic)))
      )
    const out = [head]
    if (this.place === null) return [...out, ui.dim("Loading the epic's working copy…")]
    if (this.place.ok === false) out.push(ui.refusal(this.place.error))
    const choice = this.choice()
    out.push(this.harnessPart(ui, choice))
    out.push(this.rolesPart(ui))
    out.push(this.startPart(ui, epic, choice))
    out.push(this.epicTasksPart(ui))
    return out
  }

  /**
   * @param {Parts} ui
   * @param {Choice} choice
   */
  harnessPart(ui, choice) {
    const choices = this.harnesses()
    const chosen = choices.find((h) => h.kind === choice.harness)
    return v_flex()
      .gap(4)
      .child(ui.label('Harness'))
      .child(
        h_flex()
          .gap(4)
          .flex_wrap()
          .children(
            choices.map((h) =>
              ui.chip(`harness-${h.kind}`, harnessLabel(h), {
                selected: h.kind === choice.harness,
                disabled: !h.installed,
                onClick: (_event, cx) => this.chooseHarness(cx, h.kind)
              })
            )
          )
      )
      .when(this.known?.ok === true && chosen?.installed !== true, (el) =>
        el.child(ui.dim(refusalLine({ code: 'harness_missing', fact: chosen?.label ?? choice.harness })))
      )
  }

  /** @param {Parts} ui */
  rolesPart(ui) {
    const lists = this.lists()
    if (lists === null) return v_flex().gap(4).child(ui.label('Roles')).child(ui.dim('Loading subagent types…'))
    const roles = ROLE_KEYS.map((key) => {
      const role = roleChoice(lists, key)
      return ui.select(`role-${key}`, {
        label: ROLE_TITLES[key],
        value: role.value,
        options: role.types,
        enabled: lists.on,
        open: lists.on && this.expanded === key,
        note: role.missing ? TYPE_MISSING_NOTE : null,
        onToggle: (_event, cx) => {
          this.expanded = this.expanded === key ? null : key
          cx.notify()
        },
        onPick: (type, cx) => this.chooseRole(cx, key, type)
      })
    })
    return v_flex()
      .gap(6)
      .child(ui.label('Roles'))
      .children(roles)
      .when(!lists.on, (el) => el.child(ui.dim(/** @type {{note: string}} */ (lists).note)))
      .child(ui.dim(FIXER_NOTE))
  }

  /**
   * @param {Parts} ui
   * @param {InWorkRow} epic
   * @param {Choice} choice
   */
  startPart(ui, epic, choice) {
    const { t } = ui
    const installed = this.harnesses().find((h) => h.kind === choice.harness)?.installed === true
    const ready = !this.busy && installed && this.lists() !== null && this.place?.ok === true
    const session = this.session()
    const view = startView({ session, hold: this.holds[this.epicChoiceKey()]?.hold ?? null, place: this.place, ready })
    const buttons = view.live
      ? h_flex()
          .gap(6)
          .child(ui.button('show', 'Show tab', { primary: true, onClick: () => run('space.select', { id: session.space }) }))
          .child(
            ui.button('again', 'Start again', {
              disabled: view.disabled,
              onClick: (_event, cx) => {
                this.confirmAgain = true
                cx.notify()
              }
            })
          )
      : h_flex().child(ui.button('start', 'Start', { primary: true, disabled: view.disabled, onClick: (_event, cx) => this.start(cx) }))
    return v_flex()
      .gap(6)
      .child(buttons)
      .when(view.live && this.confirmAgain, (el) =>
        el.child(
          ui.card([
            ui.title(`Start epic ${epic.id} again?`),
            ui.text(RESTART_NOTE),
            h_flex()
              .gap(6)
              .child(ui.button('again-yes', 'Yes, start', { primary: true, disabled: view.disabled, onClick: (_event, cx) => this.start(cx) }))
              .child(
                ui.button('again-no', 'Cancel', {
                  quiet: true,
                  onClick: (_event, cx) => {
                    this.confirmAgain = false
                    cx.notify()
                  }
                })
              )
          ])
        )
      )
      .children(view.lines.map((line) => div().text_size(11).text_color(t.dim).child(line)))
  }

  /** @param {Parts} ui */
  epicTasksPart(ui) {
    const { t } = ui
    if (this.epicTasks === null) return ui.dim("Loading the epic's tasks…")
    if (this.epicTasks.ok === false) return ui.refusal(this.epicTasks.error)
    const counts = taskCounts(this.epicTasks.data)
    const line = taskCountsLine(counts)
    return v_flex()
      .gap(6)
      .child(ui.label(`Tasks · ${counts.total}`))
      .when(line !== '', (el) => el.child(ui.dim(line)))
      .child(
        v_flex()
          .gap(6)
          .children(
            this.epicTasks.data.map((task) => {
              const row = epicTaskRow(task)
              return ui.row(`epic-task-${task.id}`, {
                title: row.title,
                line: row.line,
                muted: row.muted,
                lead: ui.dot(t[row.mark], { hollow: row.mark === 'idle' })
              })
            })
          )
      )
  }
}
