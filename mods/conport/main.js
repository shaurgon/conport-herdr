// The ConPort mod of Herdr: a panel that runs the epics and the tasks of a ConPort project. The
// projects are the git repositories the spaces of this machine stand in; three tabs list the
// epics to start, the epics to prepare and the tasks outside the epics; the screen of an epic
// chooses its harness and the subagent type of each role and starts its lead session; a sheet
// hands a preparation or a task to an agent. ConPort, git and the agents are read when the mod
// opens and on Refresh, never on a timer; Herdr redraws the mod when its live data changes.
import { div, View } from 'gpui-kit'
import { h_flex, InputState, Scrollbar, v_flex } from 'gpui-base'
import { agents, exec, focused, home, knownAgents, panes, readTextFile, run, setShared, shared, spaces, theme } from 'herdr'
import {
  epicListArgs,
  epicTabs,
  HAND_BUTTONS,
  readEpicTasks,
  rejectionText,
  runCli,
  subagentsArgs,
  taskCounts,
  taskCountsLine,
  taskListArgs,
  taskTabs
} from './cli.js'
import { gitDirArgs } from './git.js'
import { DEFAULT_ROLES, harnessChoices } from './harness.js'
import { handToAgent, readPlace, startEpic } from './launch.js'
import { mergeProjects, pickProject, projectBinding, spaceFolders } from './projects.js'
import { refusalLine, thrownRefusal } from './refusals.js'
import {
  epicState,
  epicTaskRow,
  FIXER_NOTE,
  handNotice,
  harnessLabel,
  NO_AGENT,
  NO_MILESTONE,
  PREPARE_HINT,
  PREPARE_STATE,
  releaseLine,
  RESTART_NOTE,
  ROLE_KEYS,
  ROLE_TITLES,
  roleChoice,
  roleLists,
  SHEET_STEPS,
  sheetAgent,
  sheetText,
  startNotice,
  startView,
  TAB_TITLES,
  tabLabel,
  TASK_GROUPS,
  taskLine,
  TYPE_MISSING_NOTE
} from './screen.js'
import { endSeenHolds, epicSession, HOLD_MS, releaseHold, startHold } from './session.js'
import { agentKey, bindingKey, chosenFor } from './state.js'
import { parts } from './ui.js'
import { CLI_VERSION, MOD_VERSION } from './version.js'

/** @import { AsyncContext, Context, Element } from 'gpui-kit' */
/** @import { Epic, EpicList, EpicTabs, EpicTask, TaskList, TaskTabs } from './cli.js' */
/** @import { Place } from './git.js' */
/** @import { KnownAgent, RoleKey, Roles } from './harness.js' */
/** @import { Binding, Project } from './projects.js' */
/** @import { Ok, Refusal, Result } from './refusals.js' */
/** @import { Sheet, Subagents, Tab } from './screen.js' */
/** @import { HoldEntry } from './session.js' */
/** @import { Parts, Theme } from './ui.js' */

/**
 * What is chosen for an epic: its harness and the subagent type of each role.
 * @typedef {{harness: string, roles: Roles}} Choice
 */

/** @type {Tab[]} */
const TABS = ['launch', 'prepare', 'tasks']

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
    this.search.on('change', (_event, cx) => cx.notify())
    this.bindDraft = InputState.new({ placeholder: 'name or handle' })
    this.bindDraft.on('submit', (_event, cx) => this.rememberProject(cx))

    /**
     * The absolute git directory of each folder of the spaces, null for one outside git.
     * @type {Record<string, string | null>}
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
    this.pickedByHand = false
    this.pickerOpen = false
    /** @type {Binding | null} */
    this.binding = null
    /** @type {Result<EpicList> | null} */
    this.epics = null
    /** @type {Result<TaskList> | null} */
    this.tasks = null
    // What the storage holds is checked against the tabs before it is used.
    const tab = /** @type {Tab} */ (stored('conport.tab', 'launch'))
    /** @type {Tab} */
    this.tab = TABS.includes(tab) ? tab : 'launch'
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
    this.epicLoad = 0
    this.refresh(cx)
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
    /** @type {Record<string, string | null>} */
    const dirs = {}
    await Promise.all(
      folders.map(async (folder) => {
        try {
          const answer = await exec('git', gitDirArgs(folder))
          dirs[folder] = answer.code === 0 && answer.stdout.trim() !== '' ? answer.stdout.trim() : null
        } catch {
          // A folder that is gone is neither a project nor a folder without git.
        }
      })
    )
    this.gitDirs = dirs
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
    return this.epics?.ok ? (this.epics.data.project ?? this.binding?.project ?? null) : null
  }

  /** @param {AsyncContext} cx */
  async loadProject(cx) {
    const mine = ++this.projectLoad
    this.epicLoad++
    this.binding = null
    this.epics = null
    this.tasks = null
    this.place = null
    this.epicTasks = null
    this.subagents = {}
    this.sheet = null
    this.confirmAgain = false
    this.expanded = null
    cx.notify()
    const project = this.current()
    if (project === null) return
    let settings = null
    try {
      settings = await readTextFile(`${project.root}/.claude/settings.local.json`)
    } catch {
      settings = null
    }
    if (mine !== this.projectLoad) return
    this.binding = projectBinding(settings, shared(bindingKey(project.gitDir)))
    cx.notify()
    if (this.binding.project === null) return
    const [epics, tasks] = await Promise.all([
      runCli(exec, epicListArgs(this.binding.project), project.root),
      runCli(exec, taskListArgs(this.binding.project), project.root)
    ])
    if (mine !== this.projectLoad) return
    this.epics = epics
    this.tasks = tasks
    if (this.opened[project.gitDir] !== undefined && this.openedEpic() === null) this.setOpened(null)
    cx.notify()
    if (this.openedEpic() !== null) await this.loadEpic(cx)
  }

  /**
   * The epic open in the chosen project, while it is listed and can run.
   * @returns {Epic | null}
   */
  openedEpic() {
    const project = this.current()
    if (project === null || !this.epics?.ok) return null
    const id = this.opened[project.gitDir]
    return (this.epics.data.epics ?? []).find((epic) => epic.id === id && epic.runnable === true) ?? null
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
   * @param {Context} cx
   * @param {Tab} tab
   */
  chooseTab(cx, tab) {
    this.tab = tab
    this.notice = null
    store('conport.tab', tab)
    cx.notify()
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
    this.sheetAgent = sheetAgent(this.harnesses(), shared(agentKey(project.gitDir)))
    this.notice = null
    this.refusal = null
    cx.notify()
  }

  /**
   * Opens the agent of the sheet in a tab of the project root, with the task the CLI gave.
   * @param {Context} cx
   */
  submitSheet(cx) {
    const open = this.sheet
    const agent = this.sheetAgent
    const project = this.current()
    const handle = this.handle()
    if (this.busy || open === null || agent === null || project === null || handle === null || !this.known?.ok) return
    const id = open.epic?.id ?? open.task.id
    this.busy = true
    this.refusal = null
    cx.spawn(async (cx) => {
      try {
        const answer = await handToAgent(
          { exec, run, setShared, spaces, panes },
          {
            kind: open.kind,
            id,
            agent,
            project: handle,
            root: project.root,
            gitDir: project.gitDir,
            // Read as the guard above found it: a sheet opens an agent only once Herdr named them.
            knownAgents: /** @type {Ok<KnownAgent[]>} */ (this.known).data
          }
        )
        if (answer.ok === false) this.refusal = answer.error
        else {
          this.sheet = null
          this.notice = handNotice({ kind: open.kind, id, project: project.name })
        }
      } catch (error) {
        this.refusal = thrownRefusal(error)
      } finally {
        this.busy = false
        cx.notify()
      }
    })
    cx.notify()
  }

  // --- drawing -----------------------------------------------------------------------------------

  render() {
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
    if (this.reading || project === null) return out
    if (this.binding === null) return [...out, ui.dim('Loading the ConPort project…')]
    if (this.binding.project === null) return [...out, this.bindCard(ui)]
    if (this.epics === null) return [...out, ui.dim('Loading epics and tasks…')]
    if (this.epics.ok === false) return [...out, ui.refusal(this.epics.error)]
    if (this.sheet !== null) return [...out, this.sheetCard(ui)]
    const epic = this.openedEpic()
    if (epic !== null) return [...out, ...this.epicScreen(ui, epic, project)]
    return [...out, ...this.sections(ui)]
  }

  /** @param {Parts} ui */
  bindCard(ui) {
    return ui.card([
      ui.title('ConPort project'),
      ui.text(refusalLine({ code: 'no_project' })),
      ui.dim("The repository's .claude/settings.local.json has no CONPORT_PROJECT_NAME. The mod remembers the project for this repository."),
      ui.input(this.bindDraft),
      h_flex().child(ui.button('bind', 'Remember', { primary: true, onClick: (_event, cx) => this.rememberProject(cx) }))
    ])
  }

  /**
   * The tabs: drawn once `body` found the epics read.
   * @param {Parts} ui
   */
  sections(ui) {
    const tabs = epicTabs(/** @type {Ok<EpicList>} */ (this.epics).data)
    const outside = this.tasks?.ok ? taskTabs(this.tasks.data) : null
    const counts = { launch: tabs.counts.launch, prepare: tabs.counts.prepare, tasks: outside?.counts.total }
    const bar = h_flex()
      .gap(4)
      .children(
        TABS.map((tab) =>
          ui.chip(`tab-${tab}`, counts[tab] === undefined ? TAB_TITLES[tab] : tabLabel(tab, counts[tab]), {
            selected: this.tab === tab,
            onClick: (_event, cx) => this.chooseTab(cx, tab)
          })
        )
      )
    const content =
      this.tab === 'launch' ? this.launchTab(ui, tabs) : this.tab === 'prepare' ? this.prepareTab(ui, tabs) : this.tasksTab(ui, outside)
    return [bar, ...content]
  }

  /**
   * @param {Parts} ui
   * @param {EpicTabs} tabs
   */
  launchTab(ui, tabs) {
    const { t } = ui
    if (tabs.counts.launch === 0 && tabs.counts.prepare === 0) {
      return [ui.title('The project has no epics'), ui.dim('An epic can start once it has a spec and a plan in ConPort.')]
    }
    if (tabs.counts.launch === 0) return [ui.dim('No epic is ready to run — prepare one in the Prepare tab.')]
    return tabs.launch.map((group) =>
      v_flex()
        .gap(4)
        .child(ui.title(group.milestone?.title ?? NO_MILESTONE))
        .when(group.release, (el) => el.child(ui.dim(releaseLine(group.milestone))))
        .children(
          group.epics.map((epic) =>
            ui.row(`epic-${epic.id}`, {
              title: `${epic.id} · ${epic.title}`,
              line: epicState(epic),
              lineColor: epic.ready ? t.done : undefined,
              onClick: (_event, cx) => this.openEpic(cx, epic.id)
            })
          )
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
   * @param {Parts} ui
   * @param {EpicTabs} tabs
   */
  prepareTab(ui, tabs) {
    const rows = tabs.prepare.map((epic) => {
      const title = `${epic.id} · ${epic.title}`
      if (epic.missing === null) return ui.row(`prepare-${epic.id}`, { title, line: PREPARE_STATE.other, muted: true })
      const label = epic.missing === 'spec' ? 'Prepare' : 'Write plan'
      return ui.row(`prepare-${epic.id}`, {
        title,
        line: PREPARE_STATE[epic.missing],
        action: ui.button(`prepare-go-${epic.id}`, label, {
          disabled: !this.canHand(),
          onClick: (_event, cx) => this.openSheet(cx, { kind: epic.missing, epic })
        })
      })
    })
    if (rows.length === 0) rows.push(ui.dim('Nothing to prepare: every epic has a spec and a plan.'))
    return [ui.dim(PREPARE_HINT), ...this.agentsNote(ui), ...rows]
  }

  /**
   * @param {Parts} ui
   * @param {TaskTabs | null} outside
   */
  tasksTab(ui, outside) {
    if (this.tasks === null) return [ui.dim('Loading tasks…')]
    if (this.tasks.ok === false) return [ui.refusal(this.tasks.error)]
    if (outside.counts.total === 0) return [ui.title('No tasks outside the epics'), ui.dim("The project's open tasks outside the epics appear here.")]
    const groups = TASK_GROUPS.filter(([key]) => outside[key].length > 0).map(([key, title]) =>
      v_flex()
        .gap(4)
        .child(ui.title(title))
        .children(
          outside[key].map((task) =>
            ui.row(`task-${task.id}`, {
              title: `${task.id} · ${task.title}`,
              line: taskLine(task),
              action:
                task.mode === null
                  ? null
                  : ui.button(`hand-${task.id}`, HAND_BUTTONS[task.mode], {
                      disabled: !this.canHand(),
                      onClick: (_event, cx) => this.openSheet(cx, { kind: task.mode, task })
                    })
            })
          )
        )
    )
    return [...this.agentsNote(ui), ...groups]
  }

  /** @param {Parts} ui */
  sheetCard(ui) {
    const open = this.sheet
    const text = sheetText(open)
    const installed = this.harnesses().filter((choice) => choice.installed)
    const last = shared(agentKey(this.current()?.gitDir ?? ''))
    return ui.card([
      ui.title(text.title),
      ui.dim(text.description),
      ui.steps(SHEET_STEPS[open.kind]),
      ui.label(text.who),
      installed.length === 0
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
            ),
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
            disabled: this.busy || this.sheetAgent === null,
            onClick: (_event, cx) => this.submitSheet(cx)
          })
        )
    ])
  }

  /**
   * @param {Parts} ui
   * @param {Epic} epic
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
          .child(ui.button('back', '← Epics', { quiet: true, onClick: (_event, cx) => this.closeEpic(cx) }))
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
   * @param {Epic} epic
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
