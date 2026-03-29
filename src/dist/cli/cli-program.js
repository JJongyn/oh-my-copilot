"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCli = createCli;
const commander_1 = require("commander");
const chat_1 = require("./commands/chat");
const run_1 = require("./commands/run");
const install_1 = require("./commands/install");
const doctor_1 = require("./commands/doctor");
const builtin_agents_1 = require("../agents/builtin-agents");
const copilot_bridge_1 = require("../provider/copilot-bridge");
const session_manager_1 = require("../session/session-manager");
const VERSION = '1.0.0';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
function createCli() {
    const program = new commander_1.Command();
    program
        .name('oh-my-copilot')
        .description('CLI tool for VSCode Copilot Chat — oh-my-openagent style, powered by vscode.lm')
        .version(VERSION, '-v, --version')
        .addHelpText('before', `
${BOLD}oh-my-copilot${RESET} v${VERSION} — VSCode Copilot Chat CLI
  Powered by ${CYAN}vscode.lm${RESET} via oh-my-copilot-bridge extension
`);
    // install command
    program
        .command('install')
        .description('Set up oh-my-copilot for this project (creates oh-my-copilot.jsonc)')
        .option('-y, --yes', 'skip confirmations')
        .option('-d, --dir <path>', 'target directory (default: cwd)')
        .action(async (opts) => {
        await (0, install_1.runInstall)(opts);
    });
    // chat command (default interactive mode)
    program
        .command('chat')
        .description('Start an interactive chat session with Copilot')
        .option('-a, --agent <name>', 'agent to use (default: sisyphus)', 'sisyphus')
        .option('-m, --model <name>', 'model family to use (default: from config or gpt-4o)')
        .option('-r, --resume <session-id>', 'resume a previous session')
        .action(async (opts) => {
        await (0, chat_1.runChat)(opts);
    });
    // run command — single task execution
    program
        .command('run <task>')
        .description('Run a single task and exit (non-interactive)')
        .option('-a, --agent <name>', 'agent to use (default: sisyphus)', 'sisyphus')
        .option('-m, --model <name>', 'model to use (default: from config or gpt-4o)')
        .option('-r, --resume <session-id>', 'resume and continue from a previous session')
        .option('--json', 'output response as JSON')
        .option('--no-stream', 'disable streaming (wait for full response)')
        .action(async (task, opts) => {
        await (0, run_1.runTask)(task, opts);
    });
    // ask command — alias for run, convenient one-liner
    program
        .command('ask <question>')
        .description('Ask a quick question using the oracle agent')
        .option('-m, --model <name>', 'model to use')
        .option('--json', 'output as JSON')
        .action(async (question, opts) => {
        await (0, run_1.runTask)(question, { ...opts, agent: 'oracle' });
    });
    // doctor command
    program
        .command('doctor')
        .description('Check system health (bridge connection, models, config)')
        .option('--verbose', 'show additional detail for each check')
        .action(async (opts) => {
        await (0, doctor_1.runDoctor)(opts);
    });
    // models command
    program
        .command('models')
        .description('List available Copilot models from the bridge')
        .action(async () => {
        const info = (0, copilot_bridge_1.readBridgeInfo)();
        if (!info) {
            console.error('\x1b[31mBridge not found. Open VS Code with oh-my-copilot-bridge installed.\x1b[0m');
            process.exit(1);
        }
        const provider = new copilot_bridge_1.CopilotBridgeProvider(info);
        try {
            const models = await provider.listModels();
            if (models.length === 0) {
                console.log('No models available. Ensure GitHub Copilot is active in VS Code.');
            }
            else {
                console.log(`\n${BOLD}Available Copilot Models:${RESET}\n`);
                for (const m of models) {
                    console.log(`  ${CYAN}${m.family || m.id}${RESET} — ${DIM}${m.name} (${m.vendor})${RESET}`);
                    if (m.maxInputTokens) {
                        console.log(`    Max input tokens: ${m.maxInputTokens.toLocaleString()}`);
                    }
                }
                console.log();
            }
        }
        catch (err) {
            console.error(`\x1b[31mFailed to list models: ${err}\x1b[0m`);
            process.exit(1);
        }
    });
    // agents command
    program
        .command('agents')
        .description('List available built-in agents')
        .action(() => {
        const agents = (0, builtin_agents_1.listAgents)();
        console.log(`\n${BOLD}Built-in Agents:${RESET}\n`);
        for (const a of agents) {
            console.log(`  ${CYAN}${a.name.padEnd(16)}${RESET} ${a.description}`);
        }
        console.log();
        console.log('Use with: oh-my-copilot chat --agent <name>');
        console.log('          oh-my-copilot run --agent <name> "<task>"');
        console.log();
    });
    // sessions command
    program
        .command('sessions')
        .description('List recent chat sessions')
        .option('-n, --limit <n>', 'max sessions to show', '20')
        .action((opts) => {
        const manager = new session_manager_1.SessionManager();
        const sessions = manager.listSessions().slice(0, parseInt(opts.limit, 10));
        if (sessions.length === 0) {
            console.log('\nNo sessions found.\n');
            return;
        }
        console.log(`\n${BOLD}Recent Sessions:${RESET}\n`);
        for (const s of sessions) {
            const title = s.title ?? '(no title)';
            console.log(`  ${CYAN}${s.id}${RESET} — ${s.agent}/${s.model} — ${s.messageCount} msgs`);
            console.log(`    ${DIM}${s.updatedAt.slice(0, 19).replace('T', ' ')} — ${title}${RESET}`);
        }
        console.log();
        console.log(`Resume with: oh-my-copilot chat --resume <session-id>`);
        console.log();
    });
    // ultrawork command — runs atlas agent for complex multi-step tasks
    program
        .command('ultrawork <task>')
        .aliases(['ulw'])
        .description('Run a complex task with the Atlas orchestrator agent (multi-step execution)')
        .option('-m, --model <name>', 'model to use')
        .option('--json', 'output as JSON')
        .action(async (task, opts) => {
        await (0, run_1.runTask)(task, { ...opts, agent: 'atlas' });
    });
    return program;
}
