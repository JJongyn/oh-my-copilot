# oh-my-copilot

<sub>Beta. 该项目仍处于测试阶段，在正式发布前部分行为可能会变化。</sub>

[![Beta](https://img.shields.io/badge/status-beta-F59E0B)](#)
[![Copilot](https://img.shields.io/badge/provider-GitHub%20Copilot-0EA5E9)](#)
[![Terminal](https://img.shields.io/badge/interface-TUI-111827)](#)
[![License](https://img.shields.io/badge/license-MIT-10B981)](#license)

面向这类团队的终端编程 Agent：可以使用 VS Code 或 Cursor 中的 GitHub Copilot Chat，但不能直接接入独立模型 API。

`oh-my-copilot` 是一个面向 Copilot 的终端工作流，灵感来自 `oh-my-openagent`，适合那些可以使用 Copilot、但不能直接接入外部模型 API 的环境。

![oh-my-copilot demo](assets/preview.png)

[English](../README.md) · [한국어](README.ko.md)

## 快速开始 🚀

```bash
npm install -g github:JJongyn/oh-my-copilot
omc
```

运行 `omc` 前，请先打开 VS Code 或 Cursor，并确保 GitHub Copilot Chat 已启用，这样 bridge extension 才会启动。

## 为什么做这个项目

- 🧩 直接使用 Copilot 订阅中已有的模型
- 🖥️ 通过 VS Code 或 Cursor bridge 在本地运行
- 🤖 支持自主执行、background agent、hooks、sessions 和 `/init`
- 🛠️ 支持基于 Markdown 的 Copilot 风格 custom agent 与 optional skills
- 🔌 同时接入 MCP 服务器和 Copilot editor tools

## 适合谁

- 已经在使用 GitHub Copilot Chat 的团队
- 企业环境中无法直接访问模型 API 的开发者
- 希望用终端而不是浏览器聊天来完成开发任务的人

## 建议先试这些 👇

```bash
omc doctor --verbose
omc
```

进入 TUI 后，建议按这个顺序先试：

- `/init`：分析当前仓库并生成 `.omc/project-context.md`
- `/harness`：生成项目专用 team 并切换到 harness mode
- `/harness regenerate`：删除已有 generated harness，并按当前模型重新生成
- `/skills`：为当前会话启用可复用 skill
- `/agent basic`：使用接近原生 Copilot 的简单助手
- `/agent sisyphus`：使用默认自主执行 Agent
- `/mcp`：查看已发现的 MCP 服务器和 Copilot editor tools
- `/background`：查看后台 sub-agent 状态

![oh-my-copilot tui](assets/terminal.png)

## TUI 命令一览

大多数用户真正会长期使用的是 TUI，而不是频繁直接调用 CLI 命令。

| TUI 命令 | 说明 |
| --- | --- |
| `/init` | 分析当前仓库并生成 `.omc/project-context.md` |
| `/harness` | 生成或刷新项目专用 harness team，激活其 skills，并进入 harness mode |
| `/harness regenerate` | 删除当前 generated harness 产物，并使用当前模型重新生成 |
| `/skills` | 查看 bundled、project、global skills，并为当前会话切换启用状态 |
| `/agent <name>` | 切换到内置或 custom agent |
| `/mode <name>` | 在 `ask`、`plan`、`agent`、`ultrawork`、`harness` 之间切换 |
| `/mcp` | 查看当前可见的 MCP 服务器和 Copilot editor tools |
| `/background` | 查看运行中或已完成的后台 sub-agent |
| `/new` | 开启新会话 |
| `/sessions` | 查看或重新打开保存的会话 |
| `/help` | 显示键盘与交互帮助 |

## CLI 命令

| 命令 | 说明 |
| --- | --- |
| `omc` | 启动交互式终端界面 |
| `omc chat` | 显式启动交互式终端界面 |
| `omc run "<task>"` | 不进入 TUI，直接执行自主任务 |
| `omc init` | 分析当前仓库并生成本地项目上下文 |
| `omc harness --generate` | 生成或刷新项目专用 harness team |
| `omc skills` | 查看可用 skill 并管理 pinned skills |
| `omc doctor --verbose` | 检查 bridge、模型、工具和 MCP 发现状态 |
| `npm run verify` | 在内部发布前执行主要验证流程 |

## Agent 与模式

主要 Agent：

- `basic`：低干预、接近 Copilot 的 assistant
- `sisyphus`：默认执行 Agent
- `hephaestus`：更深入的实现 worker
- `prometheus`：planner
- `atlas`：偏编排的重型 Agent

常用模式：

- `ask`：直接回答
- `plan`：只读规划
- `agent`：自主执行
- `ultrawork`：采用 superpowers 风格流程的强执行模式，包含探索、规划、委派、实现、复查与 Oracle 验证
- `harness`：优先使用生成出来的项目 team 与 skills 的模式

## Harness Mode

Harness mode 会把当前项目切换成 generated team workflow。

- `/harness` 会使用当前 Copilot 模型分析项目并设计 team 草案
- `/harness regenerate` 会删除已有 generated harness 产物并重新生成
- 然后在 `.github/agents/` 下生成项目专用 agent
- 同时会在 `.omc/skills/` 下生成项目专用 skill
- 当前会话会自动启用这些 skill，并切换到 `harness` mode
- 实际 runtime executor 仍然使用 `sisyphus` 或 `atlas` 这类 built-in agent，但 delegation 会优先使用 generated team
- 如果模型辅助规划失败，系统会回退到 deterministic harness scaffold，并在 TUI 中显示警告

## Custom Agent

项目级 custom agent：

```text
.github/agents/*.md
```

全局 custom agent：

```text
~/.oh-my-copilot/agents/*.md
```

支持 Copilot 风格 frontmatter，包括 `model`、`tools`、`target`、`mcp-servers`。

## Skills

Skill 是叠加在当前 agent 之上的可选 prompt bundle。

项目级 skill：

```text
.omc/skills/<name>/SKILL.md
```

个人全局 skill：

```text
~/.oh-my-copilot/skills/<name>/SKILL.md
```

常用方式：

- `/skills`：在 picker 中为当前会话切换 skill
- `/skill enable <name>`：只在当前会话启用
- `/skill pin <name>`：设为当前项目默认启用
- `omc skills --global-pin <name>`：设为所有项目默认启用

内置已经包含 `stich-*` skills，可直接用于 Stitch 风格的 UI 和前端工作流。

## Ultrawork

`ultrawork` 是内置最强的执行模式。

- 它不再只是宽松的 autonomous loop，而是遵循 superpowers 风格 workflow
- 在修改代码前会要求先做充分探索
- 在合适时会推动 agent 使用 specialist 或 background agent 做分工
- 完成前必须做验证，并回读修改后的文件
- 最后仍由 Oracle 做最终验收

## MCP 与 Copilot Tool

`oh-my-copilot` 会从 workspace 配置、编辑器用户配置以及 `~/.oh-my-copilot/mcp.json` 中发现 MCP 服务器，同时通过 bridge 暴露 `vscode.lm.tools` 中可见的 Copilot editor tools。

使用 `/mcp` 可以直接查看当前环境中可用的能力。

## 内部发布前检查

```bash
npm run verify
npm run package:bridge
omc doctor --verbose
```

## 仓库结构

```text
src/      CLI、TUI、agents、runtime、tools、sessions
bridge/   提供本地 bridge 的 VS Code extension
scripts/  安装与打包脚本
docs/     多语言文档与发布说明
```

## 说明

- 这个项目是明确面向 Copilot 的。
- 终端输入法行为仍可能因终端程序不同而略有差异。

## 参考项目

这个项目参考了 `opencode`、`oh-my-openagent` 与 `superpowers` 的思路与工作流。

## License

MIT
