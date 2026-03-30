import { useState, useCallback, useRef, useEffect } from 'react';
import { CopilotBridgeProvider } from '../../provider/copilot-bridge';
import { SessionManager } from '../../session/session-manager';
import { resolveAgent } from '../../agents/builtin-agents';
import { loadCustomAgents, type CustomAgent } from '../../agents/custom-agent-loader';
import { executeTool, TOOLS_SYSTEM_PROMPT, getProjectContext } from '../../tools/tool-definitions';
import { BackgroundAgentManager } from '../../agent-runtime/background-agent-manager';
import { runAutonomousLoop, DONE_PATTERN } from '../../agent-runtime/loop';
import { resolveHooks } from '../../agent-runtime/hooks';
import { loadConfig } from '../../config/config-manager';
import {
  getDefaultActiveSkills,
  loadSkills,
  readGlobalPinnedSkills,
  readProjectPinnedSkills,
  resolveActiveSkills,
  summarizeSkill,
  writeGlobalPinnedSkills,
  writeProjectPinnedSkills,
} from '../../skills/skill-loader';
import { generateHarness, readHarnessTeam } from '../../harness/generator';
import type { HarnessTeam } from '../../harness/types';
import type { McpClientManager } from '../../mcp/mcp-client';
import type { Session } from '../../session/session-manager';
import {
  bridgeToolResultToText,
  extractBridgeCapabilities,
  formatBridgeToolsSection,
  fromBridgeToolCallName,
  isBridgeToolCall,
  summarizeBridgeCapabilities,
  toBridgeToolCallName,
} from '../../provider/bridge-tools';
import type { BridgeToolInfo, ChatMessage } from '../../provider/types';
import type { PendingToolApproval } from '../components/ToolApprovalDialog';

/** CopilotMode — ultrawork is agent mode + Oracle verification loop */
export type CopilotMode = 'ask' | 'plan' | 'agent' | 'ultrawork' | 'harness';
export type Status = 'idle' | 'streaming' | 'error';
export type LoopPhase = 'executing' | 'verifying' | 'fixing' | 'done';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentName?: string;
  toolName?: string;
  isVerification?: boolean;
  isOracleVerdict?: boolean;
}

interface UseChatOptions {
  provider: CopilotBridgeProvider;
  initialAgent: string;
  initialModel: string;
  initialSession?: Session;
  initialMode?: CopilotMode;
  mcpClient?: McpClientManager;
  bridgeTools?: BridgeToolInfo[];
}

let msgCounter = 0;
function nextId() { return `msg-${++msgCounter}`; }

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

function getCustomAgent(name: string): CustomAgent | undefined {
  return loadCustomAgents(process.cwd()).find(agent => agent.name === name);
}

// ─── Loop Config ─────────────────────────────────────────────────────────────

/** Agents that are read-only verifiers — cannot be main workers in ultrawork */
const READ_ONLY_AGENTS = new Set(['oracle', 'explore', 'metis', 'momus', 'librarian', 'atlas']);
/** Default worker agent for ultrawork when current agent is read-only */
const ULTRAWORK_DEFAULT_AGENT = 'sisyphus';

const MAX_TOOL_ITERATIONS = 80;
const STREAM_TIMEOUT_MS = 45_000;
const MAX_ORACLE_RETRIES = 3;

/** Max times the same file path can be written before we treat it as a loop */
const MAX_WRITES_PER_FILE = 2;
const INITIAL_STREAMING_PLACEHOLDER = '[thinking] Awaiting first response token...';

// ─── Prompts ─────────────────────────────────────────────────────────────────

const CONTINUATION_PROMPT =
  'Continue working. Do not repeat completed steps. Pick up where you left off. When fully done, output <promise>DONE</promise> on its own line.';

/** Sent to Oracle as a standalone verification request */
const ORACLE_SYSTEM_PROMPT_ULTRAWORK = `You are Oracle, a critical code reviewer for oh-my-copilot.

Your job: verify that the agent FULLY completed the task. Be skeptical. Be specific.

## Output format — ALWAYS use exactly this structure:

VERDICT: PASS
(if everything is complete and correct)

— OR —

VERDICT: FAIL
ISSUES:
1. [specific, actionable issue with file path and line if possible]
2. [specific, actionable issue]

## Rules
- Default: PASS unless you find genuine problems
- Only flag real issues — not style preferences
- Max 5 issues per rejection
- Read files to verify claims before flagging
- If the task is "80% done with minor gaps", that is PASS with optional notes
- Only FAIL for: missing functionality, broken code, syntax errors, unmet requirements`;

const ORACLE_VERIFICATION_REQUEST = (originalTask: string) =>
  `Original task: "${originalTask}"

Review the current state of the codebase and verify that the task is fully complete.
Check the files that were modified, run tests if applicable, and give your PASS/FAIL verdict.`;

const ORACLE_FAILED_PROMPT = (issues: string) =>
  `Oracle has reviewed your work and found the following issues that MUST be fixed:

${issues}

Oracle does not lie. Fix ALL of these issues completely, then output <promise>DONE</promise> when done.
Do not skip any issue. Do not output DONE until every issue above is resolved.`;

// ─── Main Hook ────────────────────────────────────────────────────────────────

export function useChat({
  provider,
  initialAgent,
  initialModel,
  initialSession,
  initialMode = 'agent',
  mcpClient,
  bridgeTools = [],
}: UseChatOptions) {
  const sessionManager = useRef(new SessionManager());
  const [session, setSession] = useState<Session>(
    initialSession ??
      sessionManager.current.createSession(initialAgent, initialModel, process.cwd()),
  );
  const [agentName, setAgentName] = useState(initialAgent);
  const [model, setModel] = useState(initialModel);
  const [copilotMode, setCopilotMode] = useState<CopilotMode>(initialMode);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [agentIteration, setAgentIteration] = useState(0);
  const [loopPhase, setLoopPhase] = useState<LoopPhase>('done');
  const [tokensUsed, setTokensUsed] = useState(0);
  const [modelMaxTokens, setModelMaxTokens] = useState(0);
  const [copilotRequests, setCopilotRequests] = useState(0);
  const [chatQuota, setChatQuota] = useState<{ used: number; limit: number | null } | null>(null);
  const [activeSkills, setActiveSkills] = useState<string[]>(() =>
    initialSession?.meta.activeSkills?.length
      ? [...initialSession.meta.activeSkills]
      : getDefaultActiveSkills(process.cwd()),
  );
  const [completedMessages, setCompletedMessages] = useState<Message[]>(() =>
    (initialSession?.messages ?? []).map(m => ({
      id: nextId(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      agentName: m.role === 'assistant' ? initialAgent : undefined,
    })),
  );
  const [streamingContent, setStreamingContent] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingToolApproval | null>(null);
  const [harnessTeam, setHarnessTeam] = useState<HarnessTeam | null>(() => readHarnessTeam(process.cwd()));
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'user' | 'timeout' | null>(null);
  const backgroundAgentsRef = useRef(new BackgroundAgentManager());
  const runtimeConfigRef = useRef(loadConfig(process.cwd()));
  const availableSkillsRef = useRef(loadSkills(process.cwd()));
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  const requestTerminalApproval = useCallback(async (command: string): Promise<boolean> => {
    setPendingApproval({
      toolName: 'run_terminal',
      summary: 'The agent wants to run a terminal command.',
      details: command,
    });
    return await new Promise<boolean>((resolve) => {
      approvalResolverRef.current = (approved) => {
        approvalResolverRef.current = null;
        setPendingApproval(null);
        resolve(approved);
      };
    });
  }, []);

  // Fetch maxInputTokens for the current model
  useEffect(() => {
    provider.listModels().then(models => {
      const m = models.find(m => m.id === model || m.family === model || m.name === model);
      if (m?.maxInputTokens) setModelMaxTokens(m.maxInputTokens);
    }).catch(() => {});
  }, [provider, model]);

  // ─── Poll Copilot quota on startup and every 3 minutes ─────────────────────
  useEffect(() => {
    const fetchQuota = () => {
      provider.getCopilotUsage().then(usage => {
        if (usage) {
          setCopilotRequests(usage.requests);
          if (usage.quota?.chatMessages) setChatQuota(usage.quota.chatMessages);
        }
      }).catch(() => {});
    };
    fetchQuota(); // immediate on mount
    const interval = setInterval(fetchQuota, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [provider]);

  // ─── Build system messages ─────────────────────────────────────────────────

  const getExecutionPolicy = useCallback((agent: string, mode: CopilotMode) => {
    const customAgent = getCustomAgent(agent);
    const builtinAgent = customAgent ? null : resolveAgent(agent, model, process.cwd(), session.meta.id);
    const normalizedAllowed = customAgent?.tools?.map(normalizeToolName);
    const allowAll = !normalizedAllowed || normalizedAllowed.includes('*');
    const allowedTools = new Set(normalizedAllowed ?? []);
    const deniedTools = new Set(builtinAgent?.deniedTools ?? []);

    if (mode === 'plan' || builtinAgent?.readOnly) {
      for (const tool of READ_ONLY_TOOLS) deniedTools.add(tool);
    }

    return {
      model: customAgent?.model ?? builtinAgent?.model ?? model,
      allowTool(toolName: string): boolean {
        const normalized = normalizeToolName(toolName);
        if (!allowAll && !allowedTools.has(normalized)) return false;
        if (deniedTools.has(normalized)) return false;
        return true;
      },
      denialReason(toolName: string): string {
        const normalized = normalizeToolName(toolName);
        if (!allowAll && !allowedTools.has(normalized)) {
          return `Tool "${toolName}" is not enabled for agent "${agent}".`;
        }
        if (deniedTools.has(normalized)) {
          return `Tool "${toolName}" is denied for agent "${agent}".`;
        }
        return `Tool "${toolName}" is not available.`;
      },
    };
  }, [model, session.meta.id]);

  const buildSystemMessages = useCallback(
    (sess: Session, agent: string, mdl: string, mode: CopilotMode): ChatMessage[] => {
      const customAgent = getCustomAgent(agent);

      let systemPrompt: string;
      if (customAgent) {
        systemPrompt = customAgent.systemPrompt;
      } else {
        const agentConfig = resolveAgent(agent, mdl, process.cwd(), sess.meta.id);
        systemPrompt = agentConfig.resolvedPrompt;
      }

      const isAgentMode = mode === 'agent' || mode === 'ultrawork';
      const effectiveAgentMode = isAgentMode || mode === 'harness';

      const modeInstructions: Record<CopilotMode, string> = {
        ask: '\n\n## Mode: Ask\nAnswer the user\'s question directly and helpfully. You can answer any question — coding, general knowledge, language, science, business, etc. Be concise.',
        plan: '\n\n## Mode: Plan\nAnalyze the codebase (read-only tools), then present a step-by-step plan. Do NOT modify files.',
        agent: `\n\n## Mode: Agent (Autonomous)
Full agent mode. Use tools to complete tasks autonomously.
- Read before writing — understand context first
- edit_file for small changes, write_file for new files only
- Run tests after making changes

CRITICAL — COMPLETION SIGNAL:
- When a task is fully done, output ONLY: <promise>DONE</promise>
- Do NOT write "완료했습니다", "complete", "finished", "done", or any summary text
- Output <promise>DONE</promise> as a standalone line AFTER your last tool call
- Do NOT combine tools and <promise>DONE</promise> in the same message — do tools first, then in the NEXT message output <promise>DONE</promise>
- Simple Q&A (no tools needed): answer directly, then output <promise>DONE</promise> on the last line`,
        ultrawork: `\n\n## Mode: Ultrawork (Maximum Autonomy)

ULTRAWORK MODE ACTIVE. You are in a high-autonomy execution loop. Oracle will verify your work after you signal DONE.
This mode follows a superpowers-style workflow: brainstorming, explicit planning, focused delegation, implementation, review, and verification.

### Mandatory Execution Phases (in order)

**Phase 1 — EXPLORE** (always first, no exceptions)
- Run 3+ parallel searches with search_files / list_files / read_file
- Understand ALL files involved, existing patterns, and full blast radius
- Do NOT skip this even for small tasks — you must have evidence before acting

**Phase 2 — PLAN** (before writing any code)
- Create a mental checklist: every file to change, every step in order
- Identify what to explicitly NOT change (prevent scope creep)
- Identify verification steps for each change
- State the plan briefly in the conversation before major edits

**Phase 3 — DELEGATE WHEN USEFUL**
- If the task naturally splits, use spawn_agent or call_agent for focused side work
- Keep the main executor moving while subagents handle bounded research or review

**Phase 4 — EXECUTE** (implement everything)
- Use edit_file for targeted changes, write_file only for new files
- Make ALL changes across ALL affected files — never leave partial implementations
- Read before modifying every file

**Phase 5 — VERIFY** (mandatory after changes)
- Run run_terminal to build and test
- Read back modified files to confirm changes are correct
- Fix any failures before signaling done

**Phase 6 — SIGNAL**
- Only output <promise>DONE</promise> when ALL phases are complete and verified
- Oracle will review. If Oracle finds issues, fix them all before re-signaling DONE.

### Rules
- NEVER output DONE after just exploring or planning — execute first
- NEVER leave type errors or build failures
- NEVER stop mid-task to ask for confirmation
- If you hit a genuine blocker, describe it precisely and stop`,
        harness: `\n\n## Mode: Harness (Generated Team Active)

Harness mode is active.
- You are the execution engine for a generated project-specific team
- Prefer the generated harness agents and harness skills before generic behavior
- Delegate project-specific planning, implementation, and review to the generated team when useful
- Keep using the standard tool/runtime loop and verification discipline
- When complete, output <promise>DONE</promise> on its own line`,
      };

      let toolsSection = effectiveAgentMode ? TOOLS_SYSTEM_PROMPT : '';
      if (mode === 'plan') {
        toolsSection = `\n\n## Tools (Read-Only)\nUse read_file, list_files, search_files, git to explore. Do NOT write files.\nCall: <tool>{"name": "tool_name", "args": {...}}</tool>`;
      }

      if (effectiveAgentMode && mcpClient) {
        const policy = getExecutionPolicy(agent, mode);
        const mcpTools = mcpClient.listTools().filter(t => policy.allowTool(`${t.serverName}__${t.name}`));
        if (mcpTools.length > 0) {
          const descs = mcpTools
            .map(t => `- **${t.serverName}__${t.name}**: ${t.description ?? t.name}`)
            .join('\n');
          toolsSection += `\n\n## MCP Tools\n${descs}\n\nCall: <tool>{"name": "serverName__toolName", "args": {...}}</tool>`;
        }
      }
      if (effectiveAgentMode) {
        const policy = getExecutionPolicy(agent, mode);
        const visibleBridgeTools = bridgeTools.filter(tool => policy.allowTool(toBridgeToolCallName(tool.name)));
        toolsSection += formatBridgeToolsSection(visibleBridgeTools);
        toolsSection += summarizeBridgeCapabilities(visibleBridgeTools);

        const builtinAgent = customAgent ? null : resolveAgent(agent, mdl, process.cwd(), sess.meta.id);
        const visibleCapabilities = extractBridgeCapabilities(visibleBridgeTools);
        if (builtinAgent && (builtinAgent.recommendedSkills?.length || builtinAgent.preferredCapabilities?.length)) {
          const matchingCapabilities = (builtinAgent.preferredCapabilities ?? []).filter(cap => visibleCapabilities.includes(cap));
          const missingCapabilities = (builtinAgent.preferredCapabilities ?? []).filter(cap => !visibleCapabilities.includes(cap));
          toolsSection += `\n\n## Agent Runtime Profile\n` +
            `- Recommended skills: ${builtinAgent.recommendedSkills?.join(', ') || 'none'}\n` +
            `- Preferred capabilities: ${builtinAgent.preferredCapabilities?.join(', ') || 'none'}\n` +
            `- Available now: ${matchingCapabilities.join(', ') || 'none'}\n` +
            (missingCapabilities.length > 0 ? `- Not visible in current editor tools: ${missingCapabilities.join(', ')}\n` : '') +
            `- Use available built-in editor capabilities aggressively when they match the task.`;
        }
      }

      const activeSkillDefs = resolveActiveSkills(activeSkills, process.cwd());
      const skillsSection = activeSkillDefs.length === 0
        ? ''
        : `\n\n## Active Skills\n${activeSkillDefs.map(skill =>
            `### ${skill.name} (${skill.source})\n${summarizeSkill(skill)}\n\n${skill.systemPrompt}`
          ).join('\n\n')}`;

      const harnessSection = mode === 'harness' && harnessTeam
        ? `\n\n## Harness Team\n` +
          `- Team: ${harnessTeam.name}\n` +
          `- Pattern: ${harnessTeam.pattern}\n` +
          `- Recommended executor: ${harnessTeam.recommendedExecutor}\n` +
          `- Generated agents: ${harnessTeam.agents.map(agent => `${agent.name} (${agent.role})`).join(', ')}\n` +
          `- Generated skills: ${harnessTeam.skills.map(skill => skill.name).join(', ')}\n` +
          `Use the generated agents and skills as the primary project-specific operating layer.`
        : '';

      const projectCtx = getProjectContext(process.cwd());
      const projectSection = `\n\n## Project Context\n${projectCtx}`;

      return [{ role: 'system', content: systemPrompt + modeInstructions[mode] + toolsSection + harnessSection + skillsSection + projectSection }];
    },
    [activeSkills, bridgeTools, getExecutionPolicy, harnessTeam, mcpClient],
  );

  // ─── Stream one LLM turn ───────────────────────────────────────────────────

  const streamOneTurn = useCallback(
    async (allMessages: ChatMessage[], signal: AbortSignal, activeModel: string): Promise<string> => {
      let fullResponse = '';
      let timeoutHandle = setTimeout(() => {
        abortReasonRef.current = 'timeout';
        abortRef.current?.abort();
      }, STREAM_TIMEOUT_MS);
      try {
        for await (const chunk of provider.streamChat(allMessages, { model: activeModel, signal })) {
          clearTimeout(timeoutHandle);
          timeoutHandle = setTimeout(() => {
            abortReasonRef.current = 'timeout';
            abortRef.current?.abort();
          }, STREAM_TIMEOUT_MS);
          if (chunk.done) break;
          if (chunk.usage) {
            setTokensUsed(prev => prev + chunk.usage!.totalTokens);
          }
          if (!chunk.content) continue;
          fullResponse += chunk.content;
          setStreamingContent(fullResponse);
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        const msg = err instanceof Error ? err.message : String(err);

        // Bridge HTTP error codes
        const statusMatch = msg.match(/failed \((\d+)\)/);
        const httpStatus = statusMatch ? parseInt(statusMatch[1]) : 0;
        if (httpStatus === 404 || httpStatus === 503) {
          const e = new Error('Model not available — ensure GitHub Copilot is active in VS Code, or use /model to switch.');
          (e as any).code = 'MODEL_UNAVAILABLE';
          throw e;
        }

        if (signal.aborted || msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('cancel')) {
          const e = new Error(
            abortReasonRef.current === 'timeout'
              ? 'No response from the model for 45 seconds. The request was stopped. Try again, switch models, or check Copilot availability.'
              : 'Generation stopped.'
          );
          (e as any).code = 'REQUEST_CANCELLED';
          throw e;
        }
        throw err;
      } finally {
        clearTimeout(timeoutHandle);
      }
      // If signal was aborted (e.g. timeout mid-stream), discard partial response
      if (signal.aborted) {
        if (abortReasonRef.current === 'timeout') {
          throw new Error('No response from the model for 45 seconds. The request was stopped. Try again, switch models, or check Copilot availability.');
        }
        throw new Error('Generation stopped.');
      }
      return fullResponse;
    },
    [provider],
  );

  // ─── Oracle verification (ultrawork only) ─────────────────────────────────

  const runOracleVerification = useCallback(
    async (
      originalTask: string,
      conversationHistory: ChatMessage[],
      signal: AbortSignal,
    ): Promise<{ pass: boolean; issues: string }> => {
      setLoopPhase('verifying');
      setStreamingContent('Oracle is reviewing your work...');

      const oracleMessages: ChatMessage[] = [
        { role: 'system', content: ORACLE_SYSTEM_PROMPT_ULTRAWORK },
        // Give Oracle context of what was done
        ...conversationHistory.slice(-10), // last 10 messages for context
        { role: 'user', content: ORACLE_VERIFICATION_REQUEST(originalTask) },
      ];

      let verdict = '';
      let timeoutHandle = setTimeout(() => abortRef.current?.abort(), STREAM_TIMEOUT_MS);
      try {
        for await (const chunk of provider.streamChat(oracleMessages, { model, signal })) {
          clearTimeout(timeoutHandle);
          timeoutHandle = setTimeout(() => abortRef.current?.abort(), STREAM_TIMEOUT_MS);
          if (chunk.done) break;
          if (!chunk.content) continue;
          verdict += chunk.content;
          setStreamingContent(`Oracle: ${verdict.slice(-100)}`);
        }
      } finally {
        clearTimeout(timeoutHandle);
      }

      setStreamingContent('');

      const pass = /VERDICT:\s*PASS/i.test(verdict);
      const issuesMatch = verdict.match(/ISSUES?:\s*([\s\S]+?)(?:$|\n\n)/i);
      const issues = issuesMatch ? issuesMatch[1].trim() : verdict.replace(/VERDICT:.*\n?/i, '').trim();

      return { pass, issues };
    },
    [provider, model],
  );

  // ─── Core agent loop ──────────────────────────────────────────────────────

  const runAgentLoop = useCallback(
    async (
      content: string,
      mode: CopilotMode,
      sessionCopy: Session,
      signal: AbortSignal,
      effectiveAgent?: string,
    ) => {
      const activeAgent = effectiveAgent ?? agentName;
      const policy = getExecutionPolicy(activeAgent, mode);
      const activeModel = policy.model;
      const systemMsgs = buildSystemMessages(sessionCopy, activeAgent, model, mode);
      const conversationMsgs: ChatMessage[] = sessionCopy.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
      const result = await runAutonomousLoop({
        mode,
        originalTask: content,
        activeAgent,
        policy,
        systemMessages: systemMsgs,
        conversationMessages: conversationMsgs,
        maxIterations: MAX_TOOL_ITERATIONS,
        maxOracleRetries: MAX_ORACLE_RETRIES,
        maxWritesPerFile: MAX_WRITES_PER_FILE,
        maxContextChars: runtimeConfigRef.current.session?.maxContextChars ?? 24_000,
        preserveRecentMessages: runtimeConfigRef.current.session?.preserveRecentMessages ?? 8,
        hooks: resolveHooks(
          runtimeConfigRef.current.hooks?.enabled !== false,
          runtimeConfigRef.current.hooks?.disabled ?? [],
        ),
        signal,
        streamTurn: async (messages, modelForTurn, signalForTurn) => {
          return streamOneTurn(messages, signalForTurn, modelForTurn);
        },
        executeToolCall: async (call, _agent, modelForTurn) => {
          if (call.name === 'run_terminal') {
            const permission = runtimeConfigRef.current.permissions?.runTerminal ?? 'ask';
            if (permission === 'deny') {
              return { name: call.name, output: 'run_terminal is denied by config.', error: true };
            }
            if (permission === 'ask') {
              const approved = await requestTerminalApproval(String(call.args.command ?? ''));
              if (!approved) {
                return { name: call.name, output: 'run_terminal denied by user.', error: true };
              }
            }
          }
          if (call.name === 'call_agent') {
            const subAgentName = String(call.args.agent ?? 'oracle');
            const task = String(call.args.task ?? '');
            const subAgent = resolveAgent(subAgentName, modelForTurn, process.cwd(), session.meta.id);
            const subMessages: ChatMessage[] = [
              { role: 'system', content: subAgent.resolvedPrompt },
              { role: 'user', content: task },
            ];
            const subResponse = await provider.completeChat(subMessages, { model: subAgent.model ?? modelForTurn });
            return { name: call.name, output: `[${subAgentName}] ${subResponse}`, error: false };
          }
          if (call.name === 'spawn_agent') {
            const subAgentName = String(call.args.agent ?? 'oracle');
            const task = String(call.args.task ?? '');
            const bgTask = backgroundAgentsRef.current.spawn({
              agent: subAgentName,
              task,
              run: async (agentName, backgroundTask) => {
                const subAgent = resolveAgent(agentName, modelForTurn, process.cwd(), session.meta.id);
                const subMessages: ChatMessage[] = [
                  { role: 'system', content: subAgent.resolvedPrompt },
                  { role: 'user', content: backgroundTask },
                ];
                return provider.completeChat(subMessages, { model: subAgent.model ?? modelForTurn });
              },
            });
            return { name: call.name, output: `Spawned background task ${bgTask.id} for ${subAgentName}`, error: false };
          }
          if (call.name === 'list_background_agents') {
            const tasks = backgroundAgentsRef.current.list();
            const output = tasks.length === 0
              ? 'No background tasks.'
              : tasks.map(task => `${task.id} | ${task.agent} | ${task.status}`).join('\n');
            return { name: call.name, output, error: false };
          }
          if (call.name === 'read_background_agent') {
            const id = String(call.args.id ?? '');
            const task = backgroundAgentsRef.current.get(id);
            if (!task) {
              return { name: call.name, output: `Background task not found: ${id}`, error: true };
            }
            const output = [
              `id: ${task.id}`,
              `agent: ${task.agent}`,
              `status: ${task.status}`,
              task.result ? `result:\n${task.result}` : null,
              task.error ? `error: ${task.error}` : null,
            ].filter(Boolean).join('\n');
            return { name: call.name, output, error: false };
          }
          if (call.name === 'list_sessions') {
            const limit = Math.max(1, Number(call.args.limit) || 10);
            const query = String(call.args.query ?? '').trim();
            const sessions = query
              ? sessionManager.current.searchSessions(query)
              : sessionManager.current.listSessions();
            const output = sessions.slice(0, limit).map(s =>
              `${s.id} | ${s.agent}/${s.model} | ${s.updatedAt} | ${s.title ?? '(no title)'}`
            ).join('\n');
            return { name: call.name, output: output || 'No matching sessions.', error: false };
          }
          if (call.name === 'read_session') {
            const id = String(call.args.id ?? '');
            const sessions = sessionManager.current.listSessions();
            const match = sessions.find(s => s.id === id || s.id.startsWith(id));
            if (!match) {
              return { name: call.name, output: `Session not found: ${id}`, error: true };
            }
            const loaded = sessionManager.current.load(match.id);
            if (!loaded) {
              return { name: call.name, output: `Failed to load session: ${match.id}`, error: true };
            }
            return { name: call.name, output: sessionManager.current.exportAsMarkdown(loaded), error: false };
          }
          if (isBridgeToolCall(call.name)) {
            const bridgeResult = await provider.callEditorTool(fromBridgeToolCallName(call.name), call.args);
            return { name: call.name, output: bridgeToolResultToText(bridgeResult), error: false };
          }
          if (mcpClient && call.name.includes('__')) {
            const [serverName, toolName] = call.name.split('__');
            const mcpResult = await mcpClient.callTool(serverName, toolName, call.args);
            const text = mcpResult.content.map((c: { text?: string }) => c.text ?? '').join('\n');
            return { name: call.name, output: text, error: mcpResult.isError as boolean };
          }
          return executeTool(call, process.cwd());
        },
        verifyCompletion: mode === 'ultrawork'
          ? async (originalTask, history, signalForTurn) => {
              try {
                return await runOracleVerification(originalTask, history, signalForTurn);
              } catch {
                return { pass: true, issues: '' };
              }
            }
          : undefined,
        oracleFailedPrompt: ORACLE_FAILED_PROMPT,
        getInjectedUserMessages: () => backgroundAgentsRef.current.consumeNotifications(),
        callbacks: {
          setIteration: setAgentIteration,
          setPhase: setLoopPhase,
          clearStreaming: () => setStreamingContent(''),
          onAssistantMessage: (text, agentLabel) => {
            setCompletedMessages(prev => [
              ...prev,
              { id: nextId(), role: 'assistant', content: text, agentName: agentLabel },
            ]);
          },
          onToolResult: (text, agentLabel, toolName) => {
            setCompletedMessages(prev => [
              ...prev,
              { id: nextId(), role: 'assistant', content: text, agentName: agentLabel, toolName },
            ]);
          },
          onSystemMessage: (text, agentLabel) => {
            setCompletedMessages(prev => [
              ...prev,
              { id: nextId(), role: 'assistant', content: text, agentName: agentLabel },
            ]);
          },
          onOracleVerdict: (text) => {
            setCompletedMessages(prev => [
              ...prev,
              { id: nextId(), role: 'assistant', content: text, agentName: 'oracle:verdict', isOracleVerdict: true },
            ]);
          },
        },
      });

      const persistedAssistant = result.finalResponse || (result.completed ? '<promise>DONE</promise>' : '');
      if (persistedAssistant) {
        sessionManager.current.addMessage(sessionCopy, { role: 'assistant', content: persistedAssistant });
      }
      if (result.completed) {
        sessionManager.current.markCompleted(sessionCopy);
      }
    },
    [agentName, bridgeTools, buildSystemMessages, getExecutionPolicy, mcpClient, model, provider, requestTerminalApproval, runOracleVerification, session.meta.id, streamOneTurn],
  );

  // ─── sendMessage ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string) => {
      if (status === 'streaming') return;
      setStatus('streaming');
      setError(null);
      setAgentIteration(0);
      setLoopPhase('executing');

      const userMsg: Message = { id: nextId(), role: 'user', content };
      setCompletedMessages(prev => [...prev, userMsg]);
      setStreamingContent(INITIAL_STREAMING_PLACEHOLDER);

      const sessionCopy = session;
      sessionCopy.meta.activeSkills = [...activeSkills];
      sessionManager.current.addMessage(sessionCopy, { role: 'user', content });

      // Resolve the effective worker agent (ultrawork cannot use read-only agents)
      const effectiveAgent =
        (copilotMode === 'ultrawork' || copilotMode === 'harness') && READ_ONLY_AGENTS.has(agentName)
          ? ULTRAWORK_DEFAULT_AGENT
          : agentName;
      if (effectiveAgent !== agentName) {
        setAgentName(effectiveAgent);
      }

      if (copilotMode === 'ultrawork') {
        setCompletedMessages(prev => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: `Ultrawork mode active — ${effectiveAgent} is the executing agent. Oracle will verify automatically when the agent signals DONE.`,
            agentName: `${effectiveAgent}:system`,
          },
        ]);
      }
      if (copilotMode === 'harness' && harnessTeam) {
        setCompletedMessages(prev => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: `Harness mode active — executor: ${effectiveAgent}. Team: ${harnessTeam.name}. Generated agents: ${harnessTeam.agents.map(agent => agent.name).join(', ')}. Active skills: ${activeSkills.join(', ') || 'none'}.`,
            agentName: `${effectiveAgent}:system`,
          },
        ]);
      }

	      const abortCtrl = new AbortController();
	      abortRef.current = abortCtrl;
        abortReasonRef.current = null;

	      try {
	        await runAgentLoop(content, copilotMode, sessionCopy, abortCtrl.signal, effectiveAgent);
        setStatus('idle');
        setAgentIteration(0);
        setLoopPhase('done');
        // Poll bridge for cumulative usage
        provider.getCopilotUsage().then(usage => {
          if (usage) {
            setCopilotRequests(usage.requests);
            if (usage.quota?.chatMessages) setChatQuota(usage.quota.chatMessages);
          }
        }).catch(() => {});
	      } catch (err) {
	        setStreamingContent('');
	        const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'Generation stopped.' || msg === 'REQUEST_CANCELLED') {
            setError(null);
            setStatus('idle');
            setAgentIteration(0);
            setLoopPhase('done');
            return;
          }
	        setError(msg);
	        setStatus('error');
	        setAgentIteration(0);
	        setLoopPhase('done');
      }
    },
    [status, session, copilotMode, agentName, activeSkills, harnessTeam, runAgentLoop],
  );

  // ─── Controls ────────────────────────────────────────────────────────────

  const stopGeneration = useCallback(() => {
    abortReasonRef.current = 'user';
    abortRef.current?.abort();
    approvalResolverRef.current?.(false);
    setStatus('idle');
    setStreamingContent('');
    setAgentIteration(0);
    setLoopPhase('done');
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setCompletedMessages(prev => [
      ...prev,
      { id: nextId(), role: 'assistant', content, agentName: 'omc:system' },
    ]);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    if (status === 'error') {
      setStatus('idle');
      setLoopPhase('done');
    }
  }, [status]);

  const switchMode = useCallback(
    (newMode: CopilotMode) => {
      setCopilotMode(newMode);
      // ultrawork requires a worker agent — auto-switch away from read-only agents
      if (newMode === 'ultrawork' && READ_ONLY_AGENTS.has(agentName)) {
        setAgentName(ULTRAWORK_DEFAULT_AGENT);
      }
      if (newMode === 'harness' && READ_ONLY_AGENTS.has(agentName)) {
        setAgentName(harnessTeam?.recommendedExecutor ?? ULTRAWORK_DEFAULT_AGENT);
      }
    },
    [agentName, harnessTeam],
  );

  const switchAgent = useCallback(
    (newAgent: string) => {
      const customAgent = getCustomAgent(newAgent);
      const nextModel = customAgent?.model ?? model;
      setAgentName(newAgent);
      setModel(nextModel);
      const s = sessionManager.current.createSession(newAgent, nextModel, process.cwd());
      s.meta.activeSkills = [...activeSkills];
      setSession(s);
      setCompletedMessages([]);
      setStreamingContent('');
      setStatus('idle');
      setError(null);
      setAgentIteration(0);
      setLoopPhase('done');
    },
    [activeSkills, model],
  );

  const switchModel = useCallback(
    (newModel: string) => {
      setModel(newModel);
      session.meta.model = newModel;
      sessionManager.current.save(session);
    },
    [session],
  );

  const newSession = useCallback(() => {
    const s = sessionManager.current.createSession(agentName, model, process.cwd());
    s.meta.activeSkills = getDefaultActiveSkills(process.cwd());
    setSession(s);
    setHarnessTeam(readHarnessTeam(process.cwd()));
    setActiveSkills(s.meta.activeSkills ?? []);
    setCompletedMessages([]);
    setStreamingContent('');
    setStatus('idle');
    setError(null);
    setAgentIteration(0);
    setLoopPhase('done');
  }, [agentName, model]);

  const resumeSession = useCallback((loaded: Session) => {
    loaded.meta.activeSkills = loaded.meta.activeSkills?.length
      ? loaded.meta.activeSkills
      : getDefaultActiveSkills(process.cwd());
    setSession(loaded);
    setAgentName(loaded.meta.agent);
    setModel(loaded.meta.model);
    setHarnessTeam(readHarnessTeam(process.cwd()));
    setActiveSkills([...loaded.meta.activeSkills]);
    setCompletedMessages(
      loaded.messages.map(m => ({
        id: nextId(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        agentName: m.role === 'assistant' ? loaded.meta.agent : undefined,
      })),
    );
    setStreamingContent('');
    setStatus('idle');
    setError(null);
    setAgentIteration(0);
    setLoopPhase('done');
  }, []);

  const listSessions = useCallback(() => sessionManager.current.listSessions().slice(0, 20), []);
  const deleteSession = useCallback((id: string) => sessionManager.current.deleteSession(id), []);
  const deleteAllSessions = useCallback(
    () => sessionManager.current.deleteAllExcept(session.meta.id),
    [session],
  );
  const searchSessions = useCallback(
    (query: string) => sessionManager.current.searchSessions(query),
    [],
  );

  const approvePendingTool = useCallback(() => {
    approvalResolverRef.current?.(true);
  }, []);

  const denyPendingTool = useCallback(() => {
    approvalResolverRef.current?.(false);
  }, []);

  const setSessionSkills = useCallback((names: string[]) => {
    const deduped = Array.from(new Set(names.map(name => name.trim().toLowerCase()).filter(Boolean))).sort();
    setActiveSkills(deduped);
    session.meta.activeSkills = deduped;
    if (session.messages.length > 0) {
      sessionManager.current.save(session);
    }
  }, [session]);

  const enableSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!availableSkillsRef.current.some(skill => skill.name === normalized)) return false;
    setSessionSkills([...activeSkills, normalized]);
    return true;
  }, [activeSkills, setSessionSkills]);

  const disableSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    setSessionSkills(activeSkills.filter(skill => skill !== normalized));
  }, [activeSkills, setSessionSkills]);

  const pinSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!availableSkillsRef.current.some(skill => skill.name === normalized)) return false;
    writeProjectPinnedSkills([...readProjectPinnedSkills(process.cwd()), normalized], process.cwd());
    enableSkill(normalized);
    return true;
  }, [enableSkill]);

  const unpinSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    writeProjectPinnedSkills(
      readProjectPinnedSkills(process.cwd()).filter(skill => skill !== normalized),
      process.cwd(),
    );
  }, []);

  const globalPinSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    if (!availableSkillsRef.current.some(skill => skill.name === normalized)) return false;
    writeGlobalPinnedSkills([...readGlobalPinnedSkills(), normalized]);
    enableSkill(normalized);
    return true;
  }, [enableSkill]);

  const globalUnpinSkill = useCallback((name: string) => {
    const normalized = name.trim().toLowerCase();
    writeGlobalPinnedSkills(readGlobalPinnedSkills().filter(skill => skill !== normalized));
  }, []);

  const generateHarnessForSession = useCallback(async () => {
    setStatus('streaming');
    setError(null);
    setLoopPhase('executing');
    let planningPreview = '';
    setStreamingContent('[thinking] Harness planner is analyzing this repository...');

    try {
      const usage = await provider.getCopilotUsage().catch(() => null);
      const chatQuotaLimit = usage?.quota?.chatMessages?.limit ?? null;
      const chatQuotaUsed = usage?.quota?.chatMessages?.used ?? 0;
      if (chatQuotaLimit !== null && chatQuotaUsed >= chatQuotaLimit) {
        throw new Error('Harness generation could not start because this Copilot account has no remaining chat usage. Try again later or switch to another account.');
      }

      const team = await generateHarness(process.cwd(), {
        provider,
        model,
        onPlanningChunk: (chunk) => {
          planningPreview += chunk;
          setStreamingContent(
            `[thinking] Harness planner is designing a project-specific team...\n\n${planningPreview.slice(-800)}`,
          );
        },
      });
      setHarnessTeam(team);
      const harnessSkillNames = team.skills.map(skill => skill.name);
      setSessionSkills([...activeSkills, ...harnessSkillNames]);
      setCopilotMode('harness');
      setAgentName(team.recommendedExecutor);
      session.meta.harnessTeamName = team.name;
      session.meta.agent = team.recommendedExecutor;
      session.meta.activeSkills = Array.from(new Set([...(session.meta.activeSkills ?? []), ...harnessSkillNames])).sort();
      sessionManager.current.save(session);
      setCompletedMessages(prev => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: `Harness generated and activated.\n\n- Team: ${team.name}\n- Pattern: ${team.pattern}\n- Executor: ${team.recommendedExecutor}\n- Generation: ${team.generationMode ?? 'unknown'}${team.modelUsed ? ` (${team.modelUsed})` : ''}${team.generationWarning ? `\n- Warning: ${team.generationWarning}` : ''}\n- Agents: ${team.agents.map(agent => `${agent.name} (${agent.role})`).join(', ')}\n- Skills enabled: ${team.skills.map(skill => skill.name).join(', ')}`,
          agentName: 'harness:system',
        },
      ]);
      setStatus('idle');
      setStreamingContent('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('error');
      setStreamingContent('');
      throw err;
    }
  }, [activeSkills, model, provider, session, setSessionSkills]);

  return {
    backgroundAgents: backgroundAgentsRef.current,
    availableSkills: availableSkillsRef.current,
    activeSkills,
    harnessTeam,
    pendingApproval,
    session,
    agentName,
    model,
    copilotMode,
    status,
    error,
    agentIteration,
    loopPhase,
    completedMessages,
    streamingContent,
    tokensUsed,
    modelMaxTokens,
    copilotRequests,
    chatQuota,
    sendMessage,
    stopGeneration,
    addSystemMessage,
    dismissError,
    switchAgent,
    switchModel,
    switchMode,
    newSession,
    resumeSession,
    enableSkill,
    disableSkill,
    pinSkill,
    unpinSkill,
    globalPinSkill,
    globalUnpinSkill,
    generateHarness: generateHarnessForSession,
    approvePendingTool,
    denyPendingTool,
    listSessions,
    deleteSession,
    deleteAllSessions,
    searchSessions,
  };
}
