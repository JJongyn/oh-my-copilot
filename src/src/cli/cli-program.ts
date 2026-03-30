import { Command } from 'commander';
import { runTask } from './commands/run';
import { runInstall } from './commands/install';
import { runInit } from './commands/init';
import { runDoctor } from './commands/doctor';
import { loadConfig } from '../config/config-manager';
import { listAgents } from '../agents/builtin-agents';
import { loadCustomAgents } from '../agents/custom-agent-loader';
import { readBridgeInfo, CopilotBridgeProvider } from '../provider/copilot-bridge';
import { SessionManager } from '../session/session-manager';
import { launchTUI } from '../ui/launch';
import {
  getDefaultActiveSkills,
  loadSkills,
  readGlobalPinnedSkills,
  readProjectPinnedSkills,
  writeGlobalPinnedSkills,
  writeProjectPinnedSkills,
} from '../skills/skill-loader';
import { generateHarness, readHarnessTeam } from '../harness/generator';

const VERSION = '1.1.0';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

export function createCli(): Command {
  const program = new Command();

  program
    .name('oh-my-copilot')
    .description('CLI tool for VSCode Copilot Chat — Greek mythology agents, powered by vscode.lm')
    .version(VERSION, '-v, --version')
    .addHelpText('before', `
${BOLD}oh-my-copilot${RESET} v${VERSION} — VSCode Copilot Chat CLI
  Powered by ${CYAN}vscode.lm${RESET} via oh-my-copilot-bridge extension
  Agents: ${MAGENTA}sisyphus${RESET} | ${MAGENTA}prometheus${RESET} | ${MAGENTA}hephaestus${RESET} | ${MAGENTA}oracle${RESET} | ${MAGENTA}atlas${RESET} | ${MAGENTA}metis${RESET} | ${MAGENTA}momus${RESET}
`);

  // install command
  program
    .command('install')
    .description('Set up oh-my-copilot for this project (creates oh-my-copilot.jsonc)')
    .option('-y, --yes', 'skip confirmations')
    .option('-d, --dir <path>', 'target directory (default: cwd)')
    .action(async (opts) => {
      await runInstall(opts);
    });

  program
    .command('init')
    .description('Scaffold hierarchical AGENTS.md context for the current repository')
    .option('-d, --dir <path>', 'target directory (default: cwd)')
    .option('-f, --force', 'overwrite existing oh-my-copilot.jsonc')
    .action(async (opts) => {
      await runInit(opts);
    });

  // chat command
  program
    .command('chat')
    .description('Start interactive TUI chat with Copilot')
    .option('-a, --agent <name>', 'agent to use (default: sisyphus)', 'sisyphus')
    .option('-m, --model <name>', 'model family to use (default: from config or gpt-5-mini)')
    .option('-r, --resume <session-id>', 'resume a previous session')
    .action(async (opts) => {
      await launchTUI({ agent: opts.agent, model: opts.model, resume: opts.resume });
    });

  // run command
  program
    .command('run <task>')
    .description('Run a single task and exit (non-interactive)')
    .option('-a, --agent <name>', 'agent to use (default: sisyphus)', 'sisyphus')
    .option('-m, --model <name>', 'model to use (default: from config or gpt-5-mini)')
    .option('-r, --resume <session-id>', 'resume from a previous session')
    .option('--json', 'output response as JSON')
    .option('--no-stream', 'disable streaming')
    .action(async (task, opts) => {
      await runTask(task, opts);
    });

  // ask command
  program
    .command('ask <question>')
    .description('Ask a quick question using the oracle agent')
    .option('-m, --model <name>', 'model to use')
    .option('--json', 'output as JSON')
    .action(async (question, opts) => {
      await runTask(question, { ...opts, agent: 'oracle' });
    });

  // plan command — uses prometheus agent
  program
    .command('plan <task>')
    .description('Generate an execution plan using the Prometheus planner agent')
    .option('-m, --model <name>', 'model to use')
    .option('--json', 'output as JSON')
    .action(async (task, opts) => {
      await runTask(task, { ...opts, agent: 'prometheus' });
    });

  // doctor command
  program
    .command('doctor')
    .description('Check system health (bridge connection, models, config)')
    .option('--verbose', 'show additional detail')
    .action(async (opts) => {
      await runDoctor(opts);
    });

  // models command
  program
    .command('models')
    .description('List available Copilot models from the bridge')
    .action(async () => {
      const info = readBridgeInfo();
      if (!info) {
        console.error(`${RED}Bridge not found. Open VS Code with oh-my-copilot-bridge installed.${RESET}`);
        process.exit(1);
      }
      const provider = new CopilotBridgeProvider(info);
      try {
        const models = await provider.listModels();
        if (models.length === 0) {
          console.log('No models available. Ensure GitHub Copilot is active in VS Code.');
        } else {
          console.log(`\n${BOLD}Available Copilot Models:${RESET}\n`);
          for (const m of models) {
            console.log(`  ${CYAN}${m.family || m.id}${RESET} — ${DIM}${m.name} (${m.vendor})${RESET}`);
            if (m.maxInputTokens) {
              console.log(`    Max input tokens: ${m.maxInputTokens.toLocaleString()}`);
            }
          }
          console.log();
        }
      } catch (err) {
        console.error(`${RED}Failed to list models: ${err}${RESET}`);
        process.exit(1);
      }
    });

  // agents command
  program
    .command('agents')
    .description('List available built-in and custom agents')
    .action(() => {
      const agents = listAgents(process.cwd());

      // Group by mode
      const primary = agents.filter(a => a.mode === 'primary' || a.mode === 'all');
      const subagents = agents.filter(a => a.mode === 'subagent');

      console.log(`\n${BOLD}Primary Agents (use as main agent):${RESET}\n`);
      for (const a of primary) {
        console.log(`  ${MAGENTA}${a.name.padEnd(16)}${RESET} ${a.description}`);
      }

      if (subagents.length > 0) {
        console.log(`\n${BOLD}Specialist Agents (invoked by primary agents):${RESET}\n`);
        for (const a of subagents) {
          console.log(`  ${CYAN}${a.name.padEnd(16)}${RESET} ${a.description}`);
        }
      }

      const custom = loadCustomAgents(process.cwd());
      if (custom.length > 0) {
        console.log(`\n${BOLD}Custom Agents:${RESET}\n`);
        for (const a of custom) {
          const src = a.source === 'project' ? '.github/agents' : '~/.oh-my-copilot/agents';
          console.log(`  ${CYAN}${a.name.padEnd(16)}${RESET} ${a.description} ${DIM}(${src})${RESET}`);
        }
      }

      console.log();
      console.log('Use with: omc chat --agent <name>');
      console.log('          omc run --agent <name> "<task>"');
      console.log('          omc plan "<task>"  (uses prometheus)');
      console.log('  Custom: create .github/agents/<name>.md in your project');
      console.log();
    });

  program
    .command('skills')
    .description('List available skills and manage pinned skills')
    .option('--pin <name>', 'pin a skill for the current project')
    .option('--unpin <name>', 'remove a project-pinned skill')
    .option('--global-pin <name>', 'pin a skill globally')
    .option('--global-unpin <name>', 'remove a globally pinned skill')
    .action((opts) => {
      if (opts.pin) {
        writeProjectPinnedSkills([...readProjectPinnedSkills(process.cwd()), String(opts.pin)], process.cwd());
      }
      if (opts.unpin) {
        writeProjectPinnedSkills(
          readProjectPinnedSkills(process.cwd()).filter(name => name !== String(opts.unpin).toLowerCase()),
          process.cwd(),
        );
      }
      if (opts.globalPin) {
        writeGlobalPinnedSkills([...readGlobalPinnedSkills(), String(opts.globalPin)]);
      }
      if (opts.globalUnpin) {
        writeGlobalPinnedSkills(readGlobalPinnedSkills().filter(name => name !== String(opts.globalUnpin).toLowerCase()));
      }

      const skills = loadSkills(process.cwd());
      const projectPinned = new Set(readProjectPinnedSkills(process.cwd()));
      const globalPinned = new Set(readGlobalPinnedSkills());
      const activeByDefault = new Set(getDefaultActiveSkills(process.cwd()));

      console.log(`\n${BOLD}Skills${RESET}\n`);
      for (const skill of skills) {
        const badges = [
          activeByDefault.has(skill.name) ? 'active-by-default' : '',
          projectPinned.has(skill.name) ? 'project-pinned' : '',
          globalPinned.has(skill.name) ? 'global-pinned' : '',
          skill.source,
        ].filter(Boolean).join(', ');
        console.log(`  ${CYAN}${skill.name.padEnd(22)}${RESET} ${skill.description ?? ''} ${DIM}(${badges})${RESET}`);
      }
      console.log();
      console.log(`Project pin: ${BOLD}omc skills --pin <name>${RESET}`);
      console.log(`Global pin:  ${BOLD}omc skills --global-pin <name>${RESET}`);
      console.log(`In TUI:      ${BOLD}/skills${RESET} or ${BOLD}/skill enable <name>${RESET}`);
      console.log();
    });

  program
    .command('harness')
    .description('Generate or inspect a project-specific harness team')
    .option('--generate', 'generate or refresh the harness team')
    .option('-m, --model <name>', 'model to use for harness design')
    .action(async (opts) => {
      let team = readHarnessTeam(process.cwd());
      if (opts.generate) {
        const config = loadConfig(process.cwd());
        const info = readBridgeInfo();
        if (info) {
          const provider = new CopilotBridgeProvider(info);
          const preferredDefault = 'gpt-5-mini';
          const defaultModel = info.models.some((m: string) => m.includes(preferredDefault))
            ? preferredDefault
            : info.models[0] ?? preferredDefault;
          const chosenModel = opts.model ?? config.model ?? defaultModel;
          team = await generateHarness(process.cwd(), { provider, model: chosenModel });
        } else {
          team = await generateHarness(process.cwd());
        }
      }
      if (!team) {
        console.log('\nNo harness team found. Run: omc harness --generate\n');
        return;
      }
      console.log(`\n${BOLD}Harness Team${RESET}\n`);
      console.log(`  ${CYAN}${team.name}${RESET} — ${team.summary}`);
      console.log(`  Pattern: ${team.pattern}`);
      console.log(`  Recommended executor: ${team.recommendedExecutor}`);
      console.log(`  Generation: ${team.generationMode ?? 'unknown'}${team.modelUsed ? ` (${team.modelUsed})` : ''}`);
      console.log('\n  Agents:');
      for (const agent of team.agents) {
        console.log(`    - ${agent.name} (${agent.role})`);
      }
      console.log('\n  Skills:');
      for (const skill of team.skills) {
        console.log(`    - ${skill.name}`);
      }
      console.log();
    });

  // sessions command
  program
    .command('sessions')
    .description('List and manage chat sessions')
    .option('-n, --limit <n>', 'max sessions to show', '20')
    .option('-s, --search <query>', 'search sessions by title/agent/cwd')
    .option('--clean <days>', 'delete sessions older than N days')
    .option('--clean-all', 'delete all sessions')
    .action((opts) => {
      const manager = new SessionManager();

      // Clean operations
      if (opts.cleanAll) {
        const count = manager.deleteAllExcept();
        console.log(`${GREEN}Deleted ${count} sessions.${RESET}`);
        return;
      }
      if (opts.clean) {
        const days = parseInt(opts.clean, 10);
        const count = manager.deleteOlderThan(days);
        console.log(`${GREEN}Deleted ${count} sessions older than ${days} days.${RESET}`);
        return;
      }

      // List/search
      const limit = parseInt(opts.limit, 10);
      const sessions = opts.search
        ? manager.searchSessions(opts.search).slice(0, limit)
        : manager.listSessions().slice(0, limit);

      if (sessions.length === 0) {
        console.log(opts.search ? `\nNo sessions matching "${opts.search}".\n` : '\nNo sessions found.\n');
        return;
      }

      const stats = manager.getStats();
      const sizeKb = Math.round(stats.totalSize / 1024);
      console.log(`\n${BOLD}Sessions${RESET} (${stats.count} total, ${sizeKb}KB)\n`);

      for (const s of sessions) {
        const title = s.title ?? '(no title)';
        const done = s.completed ? `${GREEN}done${RESET}` : `${DIM}...${RESET}`;
        console.log(`  ${CYAN}${s.id.slice(0, 8)}${RESET} ${done} ${MAGENTA}${s.agent}${RESET}/${DIM}${s.model}${RESET} — ${s.messageCount} msgs`);
        console.log(`    ${DIM}${s.updatedAt.slice(0, 19).replace('T', ' ')} — ${title.slice(0, 60)}${RESET}`);
      }
      console.log();
      console.log(`Resume: ${BOLD}omc chat --resume <session-id>${RESET}`);
      console.log(`Search: ${BOLD}omc sessions --search "<query>"${RESET}`);
      console.log(`Clean:  ${BOLD}omc sessions --clean 30${RESET} (delete >30 days old)`);
      console.log();
    });

  // ultrawork command
  program
    .command('ultrawork <task>')
    .aliases(['ulw'])
    .description('Run a complex task with Atlas orchestrator + Oracle verification')
    .option('-m, --model <name>', 'model to use')
    .option('--json', 'output as JSON')
    .action(async (task, opts) => {
      await runTask(task, { ...opts, agent: 'atlas' });
    });

  return program;
}
