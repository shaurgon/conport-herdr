# ConPort mod for Herdr

A panel for the [Herdr](https://herdr.dev) app that shows the work of a
[ConPort](https://conport.app) project by SDD stage: four sections list the
epics In work, the specs waiting for their plan, the ideas and the team's
proposals not worked through, and the epics outside SDD. It brainstorms an idea
or a proposal and plans and builds a spec with an agent in a tab of the project,
starts an epic's lead session — Claude Code, Codex or Cursor — in a working copy
`epic-<N>`, and hands a task of an epic outside SDD to an agent. While it is
open, it reads every minute which rows another session took and shows them
`In progress`. What the mod reads of ConPort it reads through the
[conport CLI](https://www.npmjs.com/package/conport).

`RECIPE.md` describes what the panel shows and does, for a person and for an
agent that builds or installs it.

## What it needs

- Herdr app 0.1.15 or later.
- `npx` (Node.js 18 or later) and `git` in Herdr's environment.
- A ConPort API key: the key alone on one line in `~/.config/conport/conport.key`
  (or `CONPORT_API_KEY` in the environment Herdr runs in). The mod never reads
  or shows the key; the CLI reads it itself.
- Claude Code, Codex or Cursor. With Claude Code, the conport plugin gives the
  default subagent types of the four roles of an epic.
- Orca's conport plugin 0.9.0 or later and the Herdr mod 0.4.0 or later go
  with the conport plugin 25.1 or later; update them together.

The mod runs programs (`npx -y conport@<version>`, `git`) and, through the CLI,
reaches the ConPort service over the network.

## Install

Copy `mods/conport/` into `~/.config/herdr-app/mods/`, the folder whole, then:

```sh
herdr-app check ~/.config/herdr-app/mods/conport
```

The panel appears on the right of the window. A repository whose
`.conport.json` has `project_name` opens its ConPort project
(`.conport.local.json` beside it overrides it; an older repository's
`env.CONPORT_PROJECT_NAME` in `.claude/settings.local.json` still works); any
other asks for the project's handle once.

## Update and removal

Herdr's install does not overwrite a taken name: delete
`~/.config/herdr-app/mods/conport`, copy the new `mods/conport/` and run
`herdr-app check` again. To remove the mod, delete that folder.

## Versions

The version of the mod is `version` in `mods/conport/mod.json`; each release is
tagged `v<version>`. The mod runs one exact release of the conport CLI,
`CLI_VERSION` in `mods/conport/version.js`. The footer of the panel shows both.

## Development

The logic without gpui-kit lives in the modules of `mods/conport/` and is tested
outside Herdr; `test/fixtures/` holds recorded answers of a live Herdr
(`test/fixtures/README.md` says how they were recorded). From this folder:

```sh
node --test test/*.test.mjs
herdr-app check mods/conport
```

`herdr-app check` writes Herdr's editor typings (`gpui-kit.d.ts`, `herdr.d.ts`,
`jsconfig.json`) into the mod folder; `.gitignore` keeps them out.
