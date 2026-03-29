import * as process from 'process';
import { CopilotBridgeProvider, readBridgeInfo } from '../../provider/copilot-bridge';
import {
  bridgeToolResultToText,
  extractBridgeCapabilities,
  formatBridgeToolsSection,
  fromBridgeToolCallName,
  isBridgeToolCall,
  summarizeBridgeCapabilities,
  toBridgeToolCallName,
} from '../../provider/bridge-tools';
import { SessionManager } from '../../session/session-manager';
import { resolveAgent } from '../../agents/builtin-agents';
import { loadCustomAgents, type CustomAgent } from '../../agents/custom-agent-loader';
import { loadConfig } from '../../config/config-manager';
import { McpClientManager } from '../../mcp/mcp-client';
import { getAutoConnectMcpServers } from '../../mcp/mcp-config';
import { BackgroundAgentManager } from '../../agent-runtime/background-agent-manager';
import { executeTool, TOOLS_SYSTEM_PROMPT, getProjectContext } from '../../tools/tool-definitions';
import { runAutonomousLoop, DONE_PATTERN } from '../../agent-runtime/loop';
import { resolveHooks } from '../../agent-runtime/hooks';
import { getDefaultActiveSkills, resolveActiveSkills, summarizeSkill } from '../../skills/skill-loader';
import type { BridgeToolInfo, ChatMessage } from '../../provider/types';
import type { McpServerConfig } from '../../config/types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';

const MAX_TOOL_ITERATIONS = 40;
const STREAM_TIMEOUT_MS = 120_000;

const READ_ONLY_TOOLS = new Set(['write_file', 'edit_file', 'run_terminal']);
const TOOL_ALIAS_MAP: Record<string, string> = {
  read: 'read_file',
  read_file: 'read_file',
  write: 'write_file',
  write_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  search: 'search_files',
  search_files: 'search_files',
  list: 'list_files',
  list_files: 'list_files',
  shell: 'run_terminal',
  bash: 'run_terminal',
  terminal: 'run_terminal',
  run_in_terminal: 'run_terminal',
  run_terminal: 'run_terminal',
  git: 'git',
  call_agent: 'call_agent',
  spawn_agent: 'spawn_agent',
  list_background_agents: 'list_background_agents',
  read_background_agent: 'read_background_agent',
  list_sessions: 'list_sessions',
  read_session: 'read_session',
};

function normalizeToolName(tool: string): string {
  if (tool === '*') return '*';
  if (tool.includes('/')) return tool.replace('/', '__');
  return TOOL_ALIAS_MAP[tool] ?? tool;
}

function printError(message: string, json?: boolean, sessionId?: string): never {
  if (json) {
    console.log(JSON.stringify({ error: message, sessionId }));
  } else {
    console.error(`${RED}Error: ${message}${RESET}`);
  }
  process.exit(1);
}

function buildToolRestrictionNote(agentName: string, customAgent: CustomAgent | undefined, deniedTools: Set<string>): string {
  const lines: string[] = [];
  if (customAgent?.tools?.length) {
    lines.push(`Allowed tools for ${agentName}: ${customAgent.tools.join(', ')}`);
  }
  if (deniedTools.size > 0) {
    lines.push(`Denied tools for ${agentName}: ${Array.from(deniedTools).join(', ')}`);
  }
  if (lines.length === 0) return '';
  return `\n\n## Tool Restrictions\n${lines.map(line => `- ${line}`).join('\n')}`;
}

async function streamResponse(
  provider: CopilotBridgeProvider,
  messages: ChatMessage[],
  model: string,
  noStream: boolean,
  json: boolean,
): Promise<string> {
  if (noStream) {
    return provider.completeChat(messages, { model });
  }

  const abortCtrl = new AbortController();
  const timeout = setTimeout(() => abortCtrl.abort(), STREAM_TIMEOUT_MS);
  let fullResponse = '';

  try {
    for await (const chunk of provider.streamChat(messages, { model, signal: abortCtrl.signal })) {
      clearTimeout(timeout);
      if (chunk.done) break;
      fullResponse += chunk.content;
      if (!json) process.stdout.write(chunk.content);
    }
  } finally {
    clearTimeout(timeout);
  }

  return fullResponse;
}

export async function runTask(
  task: string,
  options: {
    agent?: string;
    model?: string;
    resume?: string;
    json?: boolean;
    noStream?: boolean;
  } = {}
): Promise<void> {
  const config = loadConfig();
  const bridgeInfo = readBridgeInfo();

  if (!bridgeInfo) {
    printError('Bridge not found. Open VS Code with oh-my-copilot-bridge extension installed.', options.json);
  }

  const provider = new CopilotBridgeProvider(bridgeInfo);
  const healthy = await provider.checkHealth().catch(() => false);
  if (!healthy) {
    printError(`Bridge not responding at 127.0.0.1:${bridgeInfo.port}. Ensure VS Code is open.`, options.json);
  }

  const preferredDefault = 'gpt-5-mini';
  const defaultModel = bridgeInfo.models.some((m: string) => m.includes(preferredDefault))
    ? preferredDefault
    : bridgeInfo.models[0] ?? preferredDefault;

  const sessionManager = new SessionManager();
  const customAgents = loadCustomAgents(process.cwd());
  const getCustomAgent = (name: string) => customAgents.find(agent => agent.name === name);

  let session = options.resume ? sessionManager.load(options.resume) : null;
  const resolvedAgentName = session?.meta.agent ?? options.agent ?? 'sisyphus';
  const customAgent = getCustomAgent(resolvedAgentName);
  const requestedModel = options.model ?? session?.meta.model ?? customAgent?.model ?? config.model ?? defaultModel;

  if (!session) {
    session = sessionManager.createSession(resolvedAgentName, requestedModel, process.cwd());
  } else {
    session.meta.agent = resolvedAgentName;
    session.meta.model = requestedModel;
  }
  session.meta.activeSkills = session.meta.activeSkills?.length
    ? session.meta.activeSkills
    : getDefaultActiveSkills(process.cwd());

  const builtinAgent = customAgent
    ? null
    : resolveAgent(resolvedAgentName, requestedModel, process.cwd(), session.meta.id);
  const normalizedAllowed = customAgent?.tools?.map(normalizeToolName);
  const allowAllTools = !normalizedAllowed || normalizedAllowed.includes('*');
  const allowedTools = new Set(normalizedAllowed ?? []);
  const deniedTools = new Set(builtinAgent?.deniedTools ?? []);
  if (builtinAgent?.readOnly) {
    for (const tool of READ_ONLY_TOOLS) deniedTools.add(tool);
  }

  const allowTool = (toolName: string): boolean => {
    const normalized = normalizeToolName(toolName);
    if (!allowAllTools && !allowedTools.has(normalized)) return false;
    if (deniedTools.has(normalized)) return false;
    return true;
  };

  const denyReason = (toolName: string): string => {
    const normalized = normalizeToolName(toolName);
    if (!allowAllTools && !allowedTools.has(normalized)) {
      return `Tool "${toolName}" is not enabled for agent "${resolvedAgentName}".`;
    }
    if (deniedTools.has(normalized)) {
      return `Tool "${toolName}" is denied for agent "${resolvedAgentName}".`;
    }
    return `Tool "${toolName}" is not available.`;
  };

  const activeModel = customAgent?.model ?? builtinAgent?.model ?? requestedModel;
  const basePrompt = customAgent?.systemPrompt ?? builtinAgent?.resolvedPrompt ?? '';

  const mcpManager = new McpClientManager();
  const backgroundAgents = new BackgroundAgentManager();
  const customAgentMcpServers = customAgents.reduce<Record<string, McpServerConfig>>((acc, agent) => {
    return {
      ...acc,
      ...Object.fromEntries(
        Object.entries(agent.mcpServers ?? {}).filter(([, server]) =>
          server.enabled !== false && server.autoStart !== false,
        ),
      ),
    };
  }, {});
  const discoveredMcpServers = getAutoConnectMcpServers(process.cwd(), config);
  const allMcpServers: Record<string, McpServerConfig> = {
    ...Object.fromEntries(
      Object.entries(config.mcpServers ?? {}).filter(([, server]) =>
        server.enabled !== false && server.autoStart !== false,
      ),
    ),
    ...discoveredMcpServers,
    ...customAgentMcpServers,
  };
  for (const disabled of config.disabledMcps ?? []) {
    delete allMcpServers[disabled];
  }
  if (Object.keys(allMcpServers).length > 0) {
    const errors = await mcpManager.connectAll(allMcpServers);
    if (errors.length > 0 && !options.json) {
      for (const { name, error } of errors) {
        console.warn(`${YELLOW}MCP server "${name}" failed to connect: ${error}${RESET}`);
      }
    }
  }

  const visibleMcpTools = mcpManager.listTools().filter(t => allowTool(`${t.serverName}__${t.name}`));
  const mcpToolsSection = visibleMcpTools.length > 0
    ? `\n\n## MCP Tools\n${visibleMcpTools
        .map(t => `- **${t.serverName}__${t.name}**: ${t.description ?? t.name}`)
        .join('\n')}\n\nCall: <tool>{"name": "serverName__toolName", "args": {...}}</tool>`
    : '';
  const bridgeTools: BridgeToolInfo[] = config.mcp?.includeEditorTools === false
    ? []
    : await provider.listEditorTools().catch(() => []);
  const visibleBridgeTools = bridgeTools.filter(tool => allowTool(toBridgeToolCallName(tool.name)));
  const bridgeToolsSection = formatBridgeToolsSection(visibleBridgeTools);
  const bridgeCapabilitiesSection = summarizeBridgeCapabilities(visibleBridgeTools);
  const visibleCapabilities = extractBridgeCapabilities(visibleBridgeTools);
  const runtimeProfileSection = builtinAgent && (builtinAgent.recommendedSkills?.length || builtinAgent.preferredCapabilities?.length)
    ? `\n\n## Agent Runtime Profile\n` +
      `- Recommended skills: ${builtinAgent.recommendedSkills?.join(', ') || 'none'}\n` +
      `- Preferred capabilities: ${builtinAgent.preferredCapabilities?.join(', ') || 'none'}\n` +
      `- Available now: ${((builtinAgent.preferredCapabilities ?? []).filter(cap => visibleCapabilities.includes(cap))).join(', ') || 'none'}\n` +
      (((builtinAgent.preferredCapabilities ?? []).filter(cap => !visibleCapabilities.includes(cap))).length > 0
        ? `- Not visible in current editor tools: ${(builtinAgent.preferredCapabilities ?? []).filter(cap => !visibleCapabilities.includes(cap)).join(', ')}\n`
        : '') +
      `- Use available built-in editor capabilities aggressively when they match the task.`
    : '';
  const activeSkillDefs = resolveActiveSkills(session.meta.activeSkills, process.cwd());
  const skillsSection = activeSkillDefs.length === 0
    ? ''
    : `\n\n## Active Skills\n${activeSkillDefs.map(skill =>
        `### ${skill.name} (${skill.source})\n${summarizeSkill(skill)}\n\n${skill.systemPrompt}`
      ).join('\n\n')}`;

  const systemPrompt = [
    basePrompt,
    `\n\n## Mode: Agent (Autonomous)
You are running in non-interactive CLI mode on top of VS Code Copilot Chat via the oh-my-copilot bridge.
- This project ONLY uses vscode.lm-backed Copilot models through the local bridge
- Use tools to complete the task autonomously
- Read before writing
- Run verification commands after changes when relevant
- When the task is fully complete, output <promise>DONE</promise> on its own line`,
    TOOLS_SYSTEM_PROMPT,
    mcpToolsSection,
    bridgeToolsSection,
    bridgeCapabilitiesSection,
    runtimeProfileSection,
    skillsSection,
    buildToolRestrictionNote(resolvedAgentName, customAgent, deniedTools),
    `\n\n## Project Context\n${getProjectContext(process.cwd())}`,
  ].join('');

  const conversation: ChatMessage[] = [...session.messages];
  const initialUserMessage: ChatMessage = { role: 'user', content: task };
  conversation.push(initialUserMessage);
  sessionManager.addMessage(session, initialUserMessage);

  if (!options.json) {
    console.log(`\n${BOLD}Task:${RESET} ${task}`);
    console.log(`${DIM}Agent: ${resolvedAgentName} | Model: ${activeModel} | Session: ${session.meta.id}${RESET}\n`);
    process.stdout.write(`${CYAN}Response${RESET}:\n\n`);
  }

  let finalResponse = '';
  let completed = false;

  try {
    const result = await runAutonomousLoop({
      mode: 'agent',
      originalTask: task,
      activeAgent: resolvedAgentName,
      policy: {
        model: activeModel,
        allowTool,
        denialReason: denyReason,
      },
      systemMessages: [{ role: 'system', content: systemPrompt }],
      conversationMessages: conversation,
      maxIterations: MAX_TOOL_ITERATIONS,
      maxContextChars: config.session?.maxContextChars ?? 24_000,
      preserveRecentMessages: config.session?.preserveRecentMessages ?? 8,
      hooks: resolveHooks(
        config.hooks?.enabled !== false,
        config.hooks?.disabled ?? [],
      ),
      signal: new AbortController().signal,
      streamTurn: async (messages, modelForTurn) => {
        const response = await streamResponse(
          provider,
          messages,
          modelForTurn,
          options.noStream === true,
          options.json === true,
        );
        if (!options.json) process.stdout.write('\n');
        return response;
      },
      executeToolCall: async (call, _activeAgentName, modelForTurn) => {
        if (call.name === 'call_agent') {
          const subAgentName = String(call.args.agent ?? 'oracle');
          const subTask = String(call.args.task ?? '');
          const subAgent = resolveAgent(subAgentName, modelForTurn, process.cwd(), session.meta.id);
          const subMessages: ChatMessage[] = [
            { role: 'system', content: subAgent.resolvedPrompt },
            { role: 'user', content: subTask },
          ];
          const subResponse = await provider.completeChat(subMessages, { model: subAgent.model ?? modelForTurn });
          return { name: call.name, output: `[${subAgentName}] ${subResponse}`, error: false };
        }
        if (call.name === 'run_terminal') {
          const permission = config.permissions?.runTerminal ?? 'ask';
          if (permission === 'deny') {
            return { name: call.name, output: 'run_terminal is denied by config.', error: true };
          }
          if (permission === 'ask') {
            return {
              name: call.name,
              output: 'run_terminal requires interactive approval. In non-interactive CLI mode, set permissions.runTerminal to "allow" to permit it.',
              error: true,
            };
          }
        }
        if (call.name === 'spawn_agent') {
          const subAgentName = String(call.args.agent ?? 'oracle');
          const subTask = String(call.args.task ?? '');
          const taskMeta = backgroundAgents.spawn({
            agent: subAgentName,
            task: subTask,
            run: async (agentName, backgroundTask) => {
              const subAgent = resolveAgent(agentName, modelForTurn, process.cwd(), session.meta.id);
              const subMessages: ChatMessage[] = [
                { role: 'system', content: subAgent.resolvedPrompt },
                { role: 'user', content: backgroundTask },
              ];
              return provider.completeChat(subMessages, { model: subAgent.model ?? modelForTurn });
            },
          });
          return { name: call.name, output: `Spawned background task ${taskMeta.id} for ${subAgentName}`, error: false };
        }
        if (call.name === 'list_background_agents') {
          const tasks = backgroundAgents.list();
          return {
            name: call.name,
            output: tasks.length === 0
              ? 'No background tasks.'
              : tasks.map(task => `${task.id} | ${task.agent} | ${task.status}`).join('\n'),
            error: false,
          };
        }
        if (call.name === 'read_background_agent') {
          const id = String(call.args.id ?? '');
          const task = backgroundAgents.get(id);
          if (!task) {
            return { name: call.name, output: `Background task not found: ${id}`, error: true };
          }
          return {
            name: call.name,
            output: [
              `id: ${task.id}`,
              `agent: ${task.agent}`,
              `status: ${task.status}`,
              task.result ? `result:\n${task.result}` : null,
              task.error ? `error: ${task.error}` : null,
            ].filter(Boolean).join('\n'),
            error: false,
          };
        }
        if (call.name === 'list_sessions') {
          const limit = Math.max(1, Number(call.args.limit) || 10);
          const query = String(call.args.query ?? '').trim();
          const sessions = query
            ? sessionManager.searchSessions(query)
            : sessionManager.listSessions();
          return {
            name: call.name,
            output: sessions.slice(0, limit).map(s =>
              `${s.id} | ${s.agent}/${s.model} | ${s.updatedAt} | ${s.title ?? '(no title)'}`
            ).join('\n') || 'No matching sessions.',
            error: false,
          };
        }
        if (call.name === 'read_session') {
          const id = String(call.args.id ?? '');
          const sessions = sessionManager.listSessions();
          const match = sessions.find(s => s.id === id || s.id.startsWith(id));
          if (!match) {
            return { name: call.name, output: `Session not found: ${id}`, error: true };
          }
          const loaded = sessionManager.load(match.id);
          if (!loaded) {
            return { name: call.name, output: `Failed to load session: ${match.id}`, error: true };
          }
          return {
            name: call.name,
            output: sessionManager.exportAsMarkdown(loaded),
            error: false,
          };
        }

        if (isBridgeToolCall(call.name)) {
          const result = await provider.callEditorTool(fromBridgeToolCallName(call.name), call.args);
          return {
            name: call.name,
            output: bridgeToolResultToText(result) || '(no output)',
            error: false,
          };
        }

        if (call.name.includes('__')) {
          const [serverName, toolName] = call.name.split('__');
          const result = await mcpManager.callTool(serverName, toolName, call.args);
          const text = result.content.map(item => item.text ?? '').join('\n').trim();
          return {
            name: call.name,
            output: text || '(no output)',
            error: result.isError as boolean,
          };
        }

        return executeTool(call, process.cwd());
      },
      callbacks: {
        onToolResult: (content) => {
          if (!options.json) process.stdout.write(`${DIM}${content}${RESET}\n`);
        },
      },
      getInjectedUserMessages: () => backgroundAgents.consumeNotifications(),
    });

    finalResponse = result.finalResponse.replace(DONE_PATTERN, '').trim();
    completed = result.completed;
    if (!finalResponse && result.completed) {
      const lastAssistant = result.conversationMessages.filter(m => m.role === 'assistant').at(-1)?.content ?? '';
      finalResponse = lastAssistant.replace(DONE_PATTERN, '').trim();
    }
  } catch (error) {
    await mcpManager.disconnectAll();
    printError(String(error), options.json, session.meta.id);
  }

  const persistedAssistant = finalResponse || (completed ? '<promise>DONE</promise>' : '');
  const assistantMessage = { role: 'assistant', content: persistedAssistant } satisfies ChatMessage;
  sessionManager.addMessage(session, assistantMessage);
  if (completed) {
    sessionManager.markCompleted(session);
  }

  if (options.json) {
    console.log(JSON.stringify({
      response: finalResponse || assistantMessage.content,
      sessionId: session.meta.id,
      agent: resolvedAgentName,
      model: activeModel,
    }));
  } else {
    console.log(`\n${DIM}Session saved: ${session.meta.id}${RESET}\n`);
  }

  await mcpManager.disconnectAll();
}
