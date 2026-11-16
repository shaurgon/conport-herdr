# Recorded Herdr answers

What a live Herdr returned to a probe mod and to `git`, kept so the mod's tests
run without Herdr, agents or a network. Every record is anonymized: the home
folder is `~`, the repository is `~/src/acme-app`, the person's own space is
`notes`, and the epic numbers in branch, folder and space names are made up.
Terminal, pane, space and tab ids are Herdr's random ids, kept as recorded.

`~` is a substitution, not program output: `git`, `spaces()`, `panes()` and
`terminals()` print absolute paths. A test substitutes one fake absolute home
for `~` in every record it loads (and gives the same home to whatever builds
`~/.herdr/worktrees/<repo>/epic-<N>`), so paths compare as they would live.

## Versions

| Program | Version |
|---|---|
| Herdr app (`herdr-app --version`) | 0.1.15 |
| herdr-core (`hc --version`) | 0.1.20 |
| Claude Code (`claude --version`) | 2.1.322 |
| Codex (`codex --version`) | codex-cli 0.167.2 |
| Cursor (`cursor-agent`) | not installed |
| git | 2.50.1 |
| npx | 11.16.0 |

The Herdr app was opened from the Dock (macOS, parent process `launchd`), not
from a terminal.

## How it was recorded

A temporary mod with `"place": "none"` in `mod.json` was opened with
`herdr-app do mod.open --name <mod>`. On open it read one request from a file,
did it, wrote the answer to a file and closed itself:

- `env`: `knownAgents()`, then `exec("npx", ["--version"])`,
  `exec("git", ["--version"])`, `exec("sh", ["-c", "command -v npx git node"])`,
  whether `CONPORT_API_KEY` is in the environment or in
  `~/.config/conport/.env` (presence only), and
  `exec("npx", ["-y", "conport@0.8.0", "epic", "list", "-p", <project>, "--json"], {cwd: home(), timeout: 300000})`
  (exit code and whether its output is JSON; nothing of the output is kept);
- `run`: `run("space.new", args)` or `run("tab.new", args)`;
- `snap`: `spaces()`, `agents()`, `panes()` and `terminals()`.

The repository was a fresh `git init` with one commit; its checkouts were made
with `git worktree add ~/.herdr/worktrees/<repo>/epic-<N> -b epic-<N> main`.
Each launch passed a task of 10968 characters as the last element of `argv`:
a first line asking the agent to reply with the last line only, then lines
with `'`, `"`, backticks, `$HOME`, `${PATH}`, `$(whoami)`, backslashes,
`\n` and `\t` written out, Cyrillic, accented and CJK letters, empty lines,
and a last line `END-OF-TASK-<random>`.

## Files

| File | What | Recorded with |
|---|---|---|
| `known-agents.json` | `knownAgents()`: the entries `claude`, `codex`, `cursor` and one other key, with `run` and `installed`, in the order returned | probe `env` |
| `exec-env.json` | what `exec` sees: `npx`, `git`, `node` found; the CLI key read from `~/.config/conport/.env`; the CLI answered with JSON, exit code 0 | probe `env` |
| `launch.json` | each `space.new` / `tab.new` sent, what it made (space and tab names), the trust question, and whether the task arrived whole (the task text is replaced by a placeholder) | probe `run`, `hc read <terminal>`, the agent's own session record |
| `claude-trust-prompt.json` | Claude Code waiting on the folder trust question 80 seconds after `space.new`: the terminal is in `panes()` (`program.key` `claude`, `status` null) and not in `agents()` | probe `snap` |
| `claude-working.json` | Claude Code `working` right after the trust question was answered | probe `snap` |
| `claude-blocked.json` | Claude Code `blocked` on a question (`report.kind` `question`) | probe `snap` |
| `claude-idle.json` | two Claude Code sessions `idle` in one space, two tabs both named `lead` (the second from `tab.new`) | probe `snap` |
| `codex-working.json` | Codex `working` right after `space.new` | probe `snap` |
| `codex-done.json` | Codex finished: `done` in `agents()` (not seen yet), `idle` in `terminals()`. There is no record of Codex `idle` in `agents()`: Herdr turns `done` into `idle` only once a person looks at the tab in the focused window, and the window was not focused while recording; `claude-idle.json` shows the same `idle` shape for Claude Code | probe `snap` |
| `codex-blocked.json` | Codex `blocked` on a command approval (`report.kind` `permission`); this session was started with `-a on-request -s read-only` to get one | probe `snap` |
| `claude-exited.json` | Claude Code quit by itself (`/exit` typed into it): its pane stays, now a login shell (`program.key` `shell`, `status` null), the terminal is `live`, and it is gone from `agents()` | probe `snap` after `hc send <terminal> /exit` |
| `codex-exited.json` | the same for Codex quit by itself (`/quit`), beside the pane of `claude-exited.json` | probe `snap` after `hc send <terminal> /quit` |
| `git-worktree-list.json` | the root and two checkouts under `~/.herdr/worktrees/<repo>/` | `git -C <folder> worktree list --porcelain` |
| `git-worktree-list-detached.json` | the same with the main checkout detached | `git -C <folder> worktree list --porcelain` |
| `git-for-each-ref-epic.json` | the branch `epic-<N>` exists | `git -C <root> for-each-ref refs/heads/epic-<N>` |
| `git-for-each-ref-none.json` | no branch of the epic | same |
| `git-common-dir.json` | the same absolute git directory from the root and from a checkout | `git -C <folder> rev-parse --path-format=absolute --git-common-dir` |
| `mod-json-check.json` | `herdr-app check` of a mod whose `mod.json` has a `version` field (and other fields) | `herdr-app check <mod folder>` |
