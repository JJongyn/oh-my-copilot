import * as readline from 'readline';
import * as process from 'process';
import { CopilotBridgeProvider, readBridgeInfo, BridgeConnectionError } from '../../provider/copilot-bridge';
import { SessionManager } from '../../session/session-manager';
import { resolveAgent } from '../../agents/builtin-agents';
import { loadConfig } from '../../config/config-manager';
import type { ChatMessage } from '../../provider/types';
import type { Session } from '../../session/session-manager';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

function printBanner(agentName: string, model: string, sessionId: string): void {
  console.log();
  console.log(`${BOLD}oh-my-copilot${RESET} — ${CYAN}${agentName}${RESET} (${DIM}${model}${RESET})`);
  console.log(`${DIM}Session: ${sessionId}${RESET}`);
  console.log(`${DIM}Type your message, or: /exit /new /history /agent <name> /model <name> /help${RESET}`);
  console.log();
}

function printHelp(): void {
  console.log(`
${BOLD}Commands:${RESET}
  /exit           — exit the chat
  /quit           — exit the chat
  /new            — start a new session
  /history        — show message history
  /agent <name>   — switch agent (sisyphus, atlas, oracle, librarian, explore, hephaestus)
  /model <name>   — switch model (gpt-4o, gpt-4o-mini, gemini-2.0, etc.)
  /sessions       — list recent sessions
  /resume <id>    — resume a session by ID
  /clear          — clear the screen
  /help           — show this help
`);
}

async function streamResponse(
  provider: CopilotBridgeProvider,
  messages: ChatMessage[],
  model: string
): Promise<string> {
  process.stdout.write(`${CYAN}assistant${RESET}: `);
  let fullResponse = '';

  try {
    for await (const chunk of provider.streamChat(messages, { model })) {
      if (chunk.done) break;
      process.stdout.write(chunk.content);
      fullResponse += chunk.content;
    }
  } catch (err) {
    process.stdout.write(`${RED}[error: ${err}]${RESET}`);
  }

  process.stdout.write('\n\n');
  return fullResponse;
}

export async function runChat(options: {
  agent?: string;
  model?: string;
  resume?: string;
  noStream?: boolean;
} = {}): Promise<void> {
  const config = loadConfig();
  const bridgeInfo = readBridgeInfo();

  if (!bridgeInfo) {
    console.error(`${RED}Error: Bridge not found.${RESET}`);
    console.error('  Open VS Code with oh-my-copilot-bridge extension installed.');
    console.error('  Run `oh-my-copilot doctor` for details.');
    process.exit(1);
  }

  const provider = new CopilotBridgeProvider(bridgeInfo);

  // Check health
  const healthy = await provider.checkHealth().catch(() => false);
  if (!healthy) {
    console.error(`${RED}Error: Bridge not responding at 127.0.0.1:${bridgeInfo.port}${RESET}`);
    console.error('  Ensure VS Code is open and the bridge extension is active.');
    process.exit(1);
  }

  const sessionManager = new SessionManager();
  let agentName = options.agent ?? 'sisyphus';
  const preferredDefault = 'gpt-5-mini';
  const chatDefaultModel = bridgeInfo.models.some((m: string) => m.includes(preferredDefault))
    ? preferredDefault
    : bridgeInfo.models[0] ?? preferredDefault;
  let model = options.model ?? config.model ?? chatDefaultModel;

  let session: Session;
  if (options.resume) {
    const loaded = sessionManager.load(options.resume);
    if (!loaded) {
      console.error(`${RED}Session not found: ${options.resume}${RESET}`);
      process.exit(1);
    }
    session = loaded;
    agentName = session.meta.agent;
    model = session.meta.model;
    console.log(`${GREEN}Resumed session ${session.meta.id}${RESET}`);
  } else {
    session = sessionManager.createSession(agentName, model, process.cwd());
  }

  let agentConfig = resolveAgent(agentName, model, process.cwd(), session.meta.id);
  let messages: ChatMessage[] = [
    { role: 'system', content: agentConfig.resolvedPrompt },
    ...session.messages,
  ];

  printBanner(agentName, model, session.meta.id);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const prompt = () => {
    rl.question(`${GREEN}you${RESET}: `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(' ');

        switch (cmd) {
          case 'exit':
          case 'quit':
            console.log(`\n${DIM}Goodbye! Session saved: ${session.meta.id}${RESET}\n`);
            rl.close();
            return;

          case 'new':
            session = sessionManager.createSession(agentName, model, process.cwd());
            agentConfig = resolveAgent(agentName, model, process.cwd(), session.meta.id);
            messages = [{ role: 'system', content: agentConfig.resolvedPrompt }];
            console.log(`\n${GREEN}New session started: ${session.meta.id}${RESET}\n`);
            break;

          case 'agent':
            if (args[0]) {
              agentName = args[0];
              agentConfig = resolveAgent(agentName, model, process.cwd(), session.meta.id);
              messages = [
                { role: 'system', content: agentConfig.resolvedPrompt },
                ...session.messages,
              ];
              console.log(`\n${GREEN}Switched to agent: ${agentName}${RESET}\n`);
            } else {
              console.log(`${YELLOW}Usage: /agent <name>${RESET} (sisyphus, atlas, oracle, librarian, explore, hephaestus)\n`);
            }
            break;

          case 'model':
            if (args[0]) {
              model = args[0];
              session.meta.model = model;
              console.log(`\n${GREEN}Switched to model: ${model}${RESET}\n`);
            } else {
              console.log(`${YELLOW}Usage: /model <name>${RESET} (e.g. gpt-4o, gpt-4o-mini, gemini-2.0)\n`);
            }
            break;

          case 'history':
            if (session.messages.length === 0) {
              console.log(`\n${DIM}No messages in this session.${RESET}\n`);
            } else {
              console.log();
              for (const msg of session.messages.slice(-10)) {
                const roleColor = msg.role === 'user' ? GREEN : CYAN;
                console.log(`${roleColor}${msg.role}${RESET}: ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
              }
              console.log();
            }
            break;

          case 'sessions': {
            const metas = sessionManager.listSessions().slice(0, 10);
            if (metas.length === 0) {
              console.log(`\n${DIM}No sessions found.${RESET}\n`);
            } else {
              console.log();
              for (const m of metas) {
                const isCurrent = m.id === session.meta.id ? ` ${YELLOW}(current)${RESET}` : '';
                console.log(`  ${DIM}${m.id}${RESET} — ${m.agent}/${m.model} — ${m.messageCount} msgs — ${m.updatedAt.slice(0, 10)}${isCurrent}`);
              }
              console.log();
            }
            break;
          }

          case 'resume': {
            if (args[0]) {
              const loaded = sessionManager.load(args[0]);
              if (loaded) {
                session = loaded;
                agentName = session.meta.agent;
                model = session.meta.model;
                agentConfig = resolveAgent(agentName, model, process.cwd(), session.meta.id);
                messages = [
                  { role: 'system', content: agentConfig.resolvedPrompt },
                  ...session.messages,
                ];
                console.log(`\n${GREEN}Resumed session ${session.meta.id} (${session.messages.length} messages)${RESET}\n`);
              } else {
                console.log(`${RED}Session not found: ${args[0]}${RESET}\n`);
              }
            } else {
              console.log(`${YELLOW}Usage: /resume <session-id>${RESET}\n`);
            }
            break;
          }

          case 'clear':
            process.stdout.write('\x1b[2J\x1b[H');
            printBanner(agentName, model, session.meta.id);
            break;

          case 'help':
            printHelp();
            break;

          default:
            console.log(`${YELLOW}Unknown command: /${cmd}. Type /help for available commands.${RESET}\n`);
        }

        prompt();
        return;
      }

      // Regular message
      const userMessage: ChatMessage = { role: 'user', content: trimmed };
      messages.push(userMessage);
      sessionManager.addMessage(session, userMessage);

      console.log();
      const response = await streamResponse(provider, messages, model);

      const assistantMessage: ChatMessage = { role: 'assistant', content: response };
      messages.push(assistantMessage);
      sessionManager.addMessage(session, assistantMessage);

      // Update session title after first exchange
      if (!session.meta.title && session.messages.length >= 2) {
        session.meta.title = sessionManager.generateTitle(session.messages);
        sessionManager.save(session);
      }

      prompt();
    });
  };

  prompt();

  rl.on('close', () => {
    process.exit(0);
  });
}
