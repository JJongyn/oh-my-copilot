# oh-my-copilot

<sub>Beta. This project is not fully stabilized yet and may change before a wider release.</sub>

[![Beta](https://img.shields.io/badge/status-beta-F59E0B)](#)
[![Copilot](https://img.shields.io/badge/provider-GitHub%20Copilot-0EA5E9)](#)
[![Terminal](https://img.shields.io/badge/interface-TUI-111827)](#)
[![License](https://img.shields.io/badge/license-MIT-10B981)](#license)

Terminal coding agent for teams that can use GitHub Copilot Chat in VS Code or Cursor, but cannot use a separate model API directly.

`oh-my-copilot` is a Copilot-first, terminal-native workflow inspired by `oh-my-openagent`, built for environments where Copilot is available but external model API usage is restricted.

![oh-my-copilot demo](docs/assets/preview.png)

[한국어](docs/README.ko.md) · [中文](docs/README.zh.md)

## Quick Start 🚀

```bash
npm install -g github:JJongyn/oh-my-copilot
omc
```

Before running `omc`, make sure VS Code or Cursor is open with GitHub Copilot Chat enabled so the bridge extension can start.

## Why This Exists

- 🧩 Uses the models already included in your Copilot plan
- 🖥️ Runs locally through a VS Code or Cursor bridge
- 🤖 Supports autonomous runs, background agents, hooks, sessions, and `/init`
- 🛠️ Loads Copilot-style custom agents and optional skills from Markdown
- 🔌 Connects both MCP servers and editor-visible Copilot tools

## Best For

- Teams already using GitHub Copilot Chat
- Enterprise environments where direct model API access is blocked
- Developers who want an `omc` terminal workflow instead of browser chat

## First Things To Try 👇

```bash
omc doctor --verbose
omc
```

Inside the TUI, this is the fastest path:

- `/init`: analyze the current repository and create `.omc/project-context.md`
- `/harness`: generate a project-specific team and switch into harness mode
- `/harness regenerate`: rebuild the generated harness team from scratch
- `/skills`: enable reusable skills for the current session
- `/agent basic`: use a plain Copilot-like assistant
- `/agent sisyphus`: use the default autonomous execution agent
- `/mcp`: inspect detected MCP servers and Copilot editor tools
- `/background`: inspect background sub-agent tasks

![oh-my-copilot tui](docs/assets/terminal.png)

## TUI Command Guide

Most users will spend their time inside the TUI rather than calling many CLI commands directly.

| In the TUI | What it does |
| --- | --- |
| `/init` | Analyze the current repository and create `.omc/project-context.md` |
| `/harness` | Generate or refresh a project-specific harness team, activate its skills, and enter harness mode |
| `/harness regenerate` | Delete the current generated harness artifacts and rebuild them with the current model |
| `/skills` | View bundled, project, and global skills, then toggle them for this session |
| `/agent <name>` | Switch to a built-in or custom agent |
| `/mode <name>` | Switch between `ask`, `plan`, `agent`, `ultrawork`, and `harness` |
| `/mcp` | Inspect MCP servers and Copilot editor tools visible right now |
| `/background` | Inspect running or completed background sub-agents |
| `/new` | Start a fresh conversation session |
| `/sessions` | Reopen or inspect saved sessions |
| `/help` | Show keyboard and interaction help |

## CLI Commands

| Command | What it does |
| --- | --- |
| `omc` | Start the interactive terminal UI |
| `omc chat` | Start the interactive terminal UI explicitly |
| `omc run "<task>"` | Run an autonomous task without entering the TUI |
| `omc init` | Analyze the current repository and create local project context |
| `omc harness --generate` | Generate or refresh a project-specific harness team |
| `omc skills` | List available skills and manage pinned skills |
| `omc doctor --verbose` | Check bridge health, models, tools, and MCP discovery |
| `npm run verify` | Run the main verification flow before release or internal rollout |

## Agents And Modes

Main agents:

- `basic`: minimal Copilot-style assistant
- `sisyphus`: default general-purpose execution agent
- `hephaestus`: deeper implementation worker
- `prometheus`: planner
- `atlas`: heavier orchestrator

Common modes:

- `ask`: direct answers
- `plan`: read-only planning
- `agent`: autonomous execution
- `ultrawork`: a superpowers-style execution workflow with exploration, planning, delegation, implementation, review, and Oracle verification
- `harness`: generated team mode, where the executor uses harness-generated agents and skills first

## Harness Mode

Harness mode turns the current project into a generated team workflow.

- `/harness` uses your current Copilot model to analyze the repo and design a project-specific team
- `/harness regenerate` clears the previous generated harness artifacts and rebuilds them from scratch
- It generates project-specific agents in `.github/agents/`
- It also generates project-specific skills in `.omc/skills/`
- The current session automatically enables those skills and switches into `harness` mode
- The runtime still uses a built-in executor such as `sisyphus` or `atlas`, but it prefers the generated project team for delegation
- If model-assisted planning fails, `oh-my-copilot` falls back to a deterministic harness scaffold and shows a warning in the TUI

## Custom Agents

Project-level custom agents:

```text
.github/agents/*.md
```

Global custom agents:

```text
~/.oh-my-copilot/agents/*.md
```

Copilot-style frontmatter such as `model`, `tools`, `target`, and `mcp-servers` is supported.

## Skills

Skills are optional prompt bundles layered on top of your active agent.

Project skills:

```text
.omc/skills/<name>/SKILL.md
```

Personal reusable skills:

```text
~/.oh-my-copilot/skills/<name>/SKILL.md
```

Useful commands:

- `/skills`: open the picker and toggle skills for the current session
- `/skill enable <name>`: enable one skill now
- `/skill pin <name>`: make a skill active by default for this project
- `omc skills --global-pin <name>`: make a skill active by default everywhere

Bundled `stich-*` skills are included out of the box for Stitch-style UI and frontend workflows.

## Ultrawork

`ultrawork` is the strongest built-in execution mode.

- It now follows a superpowers-style workflow instead of a loose autonomous loop
- It requires exploration before code changes
- It pushes the agent to delegate focused side work when useful
- It requires verification and read-back review before completion
- Oracle still performs the final verification pass before the task is accepted

## MCP And Copilot Tools

`oh-my-copilot` reads MCP config from workspace files, editor user config, and `~/.oh-my-copilot/mcp.json`. It also exposes editor-visible tools from `vscode.lm.tools` through the bridge.

Use `/mcp` to inspect what is currently available in your environment.

## Verify Before Deploying Internally

```bash
npm run verify
npm run package:bridge
omc doctor --verbose
```

## Repository Layout

```text
src/      CLI, TUI, agents, runtime, tools, sessions
bridge/   VS Code extension exposing the local bridge
scripts/  install and packaging helpers
docs/     translated docs and release notes
```

## Notes

- This project is intentionally Copilot-specific.
- Terminal IME behavior can still vary by terminal emulator.
- `run_terminal` uses a permission layer. Default is `ask` in TUI, so terminal commands require approval.
- In non-interactive `omc run`, set `permissions.runTerminal` to `allow` if you want shell execution.

Example:

```json
{
  "permissions": {
    "runTerminal": "ask"
  }
}
```

## Acknowledgements

This project is informed by the ideas and workflows of `opencode`, `oh-my-openagent`, and `superpowers`.

## License

MIT
