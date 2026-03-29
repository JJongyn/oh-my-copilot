import { parseToolCalls } from '../tools/tool-definitions';
import type { ChatMessage } from '../provider/types';
import {
  createRuntimeHookState,
  type RuntimeHook,
  type HookOutcome,
  type UserPromptHookInput,
  type PreToolHookInput,
  type PostToolHookInput,
  type StopHookInput,
} from './hooks';

export type RuntimeMode = 'ask' | 'plan' | 'agent' | 'ultrawork' | 'harness';
export type RuntimePhase = 'executing' | 'verifying' | 'fixing' | 'done';

export const DONE_PATTERN = /<promise>\s*DONE\s*<\/promise>/i;
export const SEMANTIC_DONE_PATTERN = /(?:완료했습니다|완료되었습니다|완료 했습니다|마쳤습니다|끝났습니다|수정했습니다|변경했습니다|리팩토링\s*(?:완료|완성)|변경사항을\s*(?:확인|검토)|확인하세요|검토하세요|적용했습니다|구현했습니다|refactor(?:ing)?\s*(?:complete|done|finished)|task\s*(?:complete|done|finished)|all\s*(?:done|complete|changes?\s*(?:applied|made))|changes?\s*(?:applied|made|complete)|implementation\s*(?:complete|done))/i;

export interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
}

export interface RuntimeToolResult {
  name: string;
  output: string;
  error?: boolean;
}

export interface RuntimePolicy {
  model: string;
  allowTool: (toolName: string) => boolean;
  denialReason: (toolName: string) => string;
}

export interface RuntimeCallbacks {
  setIteration?: (iteration: number) => void;
  setPhase?: (phase: RuntimePhase) => void;
  clearStreaming?: () => void;
  onAssistantMessage?: (content: string, agentName: string) => void;
  onToolResult?: (content: string, agentName: string, toolName: string) => void;
  onSystemMessage?: (content: string, agentName: string) => void;
  onOracleVerdict?: (content: string) => void;
}

export interface RuntimeOptions {
  mode: RuntimeMode;
  originalTask: string;
  activeAgent: string;
  policy: RuntimePolicy;
  systemMessages: ChatMessage[];
  conversationMessages: ChatMessage[];
  maxIterations: number;
  maxOracleRetries?: number;
  maxWritesPerFile?: number;
  maxContextChars?: number;
  preserveRecentMessages?: number;
  hooks?: RuntimeHook[];
  streamTurn: (allMessages: ChatMessage[], activeModel: string, signal: AbortSignal) => Promise<string>;
  executeToolCall: (call: ToolCallLike, activeAgent: string, activeModel: string, mode: RuntimeMode) => Promise<RuntimeToolResult>;
  verifyCompletion?: (originalTask: string, conversationHistory: ChatMessage[], signal: AbortSignal) => Promise<{ pass: boolean; issues: string }>;
  continuationPrompt?: (iteration: number, toolResults: string[]) => string;
  doneContinuationPrompt?: (iteration: number) => string;
  oracleFailedPrompt?: (issues: string) => string;
  getInjectedUserMessages?: () => ChatMessage[];
  callbacks?: RuntimeCallbacks;
  signal: AbortSignal;
}

export interface RuntimeResult {
  finalResponse: string;
  completed: boolean;
  conversationMessages: ChatMessage[];
}

function estimateContextChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

function truncateToolResult(result: string, maxChars = 1200): string {
  if (result.length <= maxChars) return result;
  return `${result.slice(0, maxChars)}\n... [truncated ${result.length - maxChars} chars]`;
}

function buildCompactionSummary(messages: ChatMessage[], originalTask: string): string {
  const toolLines = messages
    .flatMap(message => message.content.split('\n'))
    .filter(line => line.startsWith('[tool:'))
    .slice(0, 12);

  const notableMessages = messages
    .filter(message => !message.content.startsWith('[CONTINUATION'))
    .map(message => message.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(content => !content.startsWith('[tool:'))
    .slice(0, 6);

  const lines = [
    '[COMPACTED CONTEXT SUMMARY]',
    `Original task: ${originalTask}`,
    `Compacted ${messages.length} older messages to reduce token usage.`,
  ];

  if (notableMessages.length > 0) {
    lines.push('Earlier important messages:');
    lines.push(...notableMessages.map(message => `- ${message.slice(0, 220)}`));
  }

  if (toolLines.length > 0) {
    lines.push('Earlier tool results:');
    lines.push(...toolLines.map(line => `- ${line.slice(0, 220)}`));
  }

  lines.push('Use this summary instead of re-reading the compacted raw history unless necessary.');
  return lines.join('\n');
}

function compactConversationHistory(
  messages: ChatMessage[],
  originalTask: string,
  preserveRecentMessages: number,
): { removedCount: number; summaryAdded: boolean } {
  if (messages.length <= preserveRecentMessages + 2) {
    return { removedCount: 0, summaryAdded: false };
  }

  const preserveCount = Math.max(2, preserveRecentMessages);
  const removed = messages.splice(0, Math.max(0, messages.length - preserveCount));
  const summary = buildCompactionSummary(removed, originalTask);
  messages.unshift({ role: 'user', content: summary });
  return { removedCount: removed.length, summaryAdded: true };
}

export async function runAutonomousLoop(opts: RuntimeOptions): Promise<RuntimeResult> {
  const {
    mode,
    originalTask,
    activeAgent,
    policy,
    systemMessages,
    conversationMessages,
    maxIterations,
    maxOracleRetries = 0,
    maxWritesPerFile = 2,
    maxContextChars = 24_000,
    preserveRecentMessages = 8,
    hooks = [],
    streamTurn,
    executeToolCall,
    verifyCompletion,
    continuationPrompt = (iteration, toolResults) =>
      `[CONTINUATION — iter ${iteration}] Tool execution complete.\n\nTool results:\n${toolResults.join('\n')}\n\nContinue. When done, output <promise>DONE</promise> on its own line.`,
    doneContinuationPrompt = (iteration) =>
      `[CONTINUATION — iter ${iteration}] If the task is complete, output <promise>DONE</promise> immediately. Do NOT summarize — just output the tag. If not complete, use your tools to continue.`,
    oracleFailedPrompt = (issues) =>
      `Oracle has reviewed your work and found the following issues that MUST be fixed:\n\n${issues}\n\nOracle does not lie. Fix ALL of these issues completely, then output <promise>DONE</promise> when done.\nDo not skip any issue. Do not output DONE until every issue above is resolved.`,
    getInjectedUserMessages,
    callbacks,
    signal,
  } = opts;

  const recentCalls: Array<{ name: string; argsStr: string }> = [];
  const fileWriteCount = new Map<string, number>();
  const hookState = createRuntimeHookState();
  let noToolCount = 0;
  let oracleRetries = 0;
  let compacted = false;

  async function runHooks<T extends HookOutcome>(
    stage: 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop',
    input: UserPromptHookInput | PreToolHookInput | PostToolHookInput | StopHookInput,
  ): Promise<T[]> {
    const stageHooks = hooks.filter(hook => hook.stage === stage);
    const outcomes: T[] = [];
    for (const hook of stageHooks) {
      const outcome = await hook.run(input) as T;
      outcomes.push(outcome);
      if (outcome.message) {
        callbacks?.onSystemMessage?.(`[hook:${hook.name}] ${outcome.message}`, `${activeAgent}:system`);
      }
      if (outcome.injectMessages?.length) {
        conversationMessages.push(...outcome.injectMessages);
      }
    }
    return outcomes;
  }

  const firstUserMessage = conversationMessages.find(message => message.role === 'user')?.content ?? originalTask;
  await runHooks('UserPromptSubmit', {
    mode,
    activeAgent,
    originalTask,
    conversationMessages,
    state: hookState,
    userMessage: firstUserMessage,
  });

  const checkDoomLoop = (name: string, args: unknown): boolean => {
    const argsStr = JSON.stringify(args);
    recentCalls.push({ name, argsStr });
    if (recentCalls.length < 3) return false;
    const last = recentCalls.slice(-3);
    return last.every(c => c.name === name && c.argsStr === argsStr);
  };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    callbacks?.setIteration?.(iteration);
    callbacks?.setPhase?.('executing');

    const injectedMessages = getInjectedUserMessages?.() ?? [];
    if (injectedMessages.length > 0) {
      conversationMessages.push(...injectedMessages);
    }

    if (estimateContextChars(conversationMessages) > maxContextChars) {
      const { removedCount, summaryAdded } = compactConversationHistory(
        conversationMessages,
        originalTask,
        preserveRecentMessages,
      );
      if (summaryAdded) {
        callbacks?.onSystemMessage?.(
          `Context compacted proactively — summarized ${removedCount} older messages before the next turn.`,
          `${activeAgent}:system`,
        );
      }
    }

    const allMessages: ChatMessage[] = [...systemMessages, ...conversationMessages];
    let fullResponse: string;

    try {
      fullResponse = await streamTurn(allMessages, policy.model, signal);
    } catch (err) {
      const code = (err as any)?.code as string | undefined;
      if (code === 'REQUEST_CANCELLED' && conversationMessages.length > 8 && !compacted) {
        compacted = true;
        const { removedCount } = compactConversationHistory(
          conversationMessages,
          originalTask,
          Math.max(4, Math.floor(preserveRecentMessages / 2)),
        );
        callbacks?.clearStreaming?.();
        callbacks?.onSystemMessage?.(
          `Context compacted after cancellation — summarized ${removedCount} older messages. Retrying...`,
          `${activeAgent}:system`,
        );
        iteration--;
        continue;
      }
      throw err;
    }

    if (mode === 'agent' || mode === 'ultrawork' || mode === 'harness' || mode === 'plan') {
      const { calls, cleanText } = parseToolCalls(fullResponse);

      if (calls.length > 0) {
        const displayText = cleanText.replace(DONE_PATTERN, '').trim();
        if (displayText) {
          callbacks?.onAssistantMessage?.(displayText, activeAgent);
        }
        callbacks?.clearStreaming?.();

        for (const call of calls) {
          if (call.name === 'write_file') {
            const fp = String(call.args.path ?? '');
            const count = (fileWriteCount.get(fp) ?? 0) + 1;
            fileWriteCount.set(fp, count);
            if (count >= maxWritesPerFile) {
              callbacks?.onSystemMessage?.(
                `Stopped: "${fp}" written ${count} times — treating as complete to prevent loop.`,
                `${activeAgent}:system`,
              );
              return { finalResponse: fullResponse, completed: true, conversationMessages };
            }
          }
        }

        const validCalls: ToolCallLike[] = [];
        let doomLooped = false;
        for (const call of calls) {
          if (!policy.allowTool(call.name)) {
            validCalls.push(call);
            continue;
          }
          if (checkDoomLoop(call.name, call.args)) {
            callbacks?.onSystemMessage?.(
              `Stopped: doom loop — "${call.name}" called 3x with identical args.`,
              `${activeAgent}:system`,
            );
            doomLooped = true;
            break;
          }
          validCalls.push(call);
        }
        if (doomLooped) {
          return { finalResponse: fullResponse, completed: false, conversationMessages };
        }

        const parallelResults = await Promise.all(validCalls.map(async (call) => {
          const preOutcomes = await runHooks('PreToolUse', {
            mode,
            activeAgent,
            originalTask,
            conversationMessages,
            state: hookState,
            call,
          });
          if (preOutcomes.some(outcome => outcome.allow === false)) {
            return {
              name: call.name,
              output: preOutcomes.find(outcome => outcome.allow === false)?.message ?? policy.denialReason(call.name),
              error: true,
            } satisfies RuntimeToolResult;
          }
          const result = await executeToolCall(call, activeAgent, policy.model, mode);
          await runHooks('PostToolUse', {
            mode,
            activeAgent,
            originalTask,
            conversationMessages,
            state: hookState,
            call,
            result,
          });
          return result;
        }));

        const results: string[] = [];
        for (const result of parallelResults) {
          const resultText = result.error
            ? `[tool:${result.name}] ERROR: ${result.output}`
            : `[tool:${result.name}] ${result.output}`;
          results.push(resultText);
          callbacks?.onToolResult?.(resultText, `${activeAgent}:tool`, result.name);
        }

        const compactResults = results.map(result => truncateToolResult(result));

        conversationMessages.push({ role: 'assistant', content: fullResponse });

        const hasExplicitDone = DONE_PATTERN.test(fullResponse);
        const hasSemanticDone = displayText.length > 0 && SEMANTIC_DONE_PATTERN.test(displayText);
        if (hasExplicitDone || hasSemanticDone) {
          const stopOutcomes = await runHooks('Stop', {
            mode,
            activeAgent,
            originalTask,
            conversationMessages,
            state: hookState,
            finalResponse: fullResponse,
          });
          if (stopOutcomes.some(outcome => outcome.allow === false)) {
            noToolCount = 0;
            continue;
          }
          return { finalResponse: fullResponse, completed: true, conversationMessages };
        }

        conversationMessages.push({
          role: 'user',
          content: continuationPrompt(iteration, compactResults),
        });
        noToolCount = 0;
        continue;
      }
    }

    const isDone = DONE_PATTERN.test(fullResponse);
    const displayContent = fullResponse.replace(DONE_PATTERN, '').trim();

    if (isDone) {
      if (displayContent) {
        callbacks?.onAssistantMessage?.(displayContent, activeAgent);
      }
      callbacks?.clearStreaming?.();

      if (mode === 'ultrawork' && verifyCompletion && oracleRetries < maxOracleRetries) {
        callbacks?.setPhase?.('verifying');
        const { pass, issues } = await verifyCompletion(originalTask, [...systemMessages, ...conversationMessages], signal);
        const oracleMsg = pass
          ? '✓ Oracle: PASS — work verified complete'
          : `✗ Oracle: FAIL\n\n${issues}`;
        callbacks?.onOracleVerdict?.(oracleMsg);
        if (pass) {
          return { finalResponse: fullResponse, completed: true, conversationMessages };
        }
        oracleRetries++;
        callbacks?.setPhase?.('fixing');
        conversationMessages.push({ role: 'assistant', content: fullResponse });
        conversationMessages.push({ role: 'user', content: oracleFailedPrompt(issues) });
        noToolCount = 0;
        continue;
      }

      const stopOutcomes = await runHooks('Stop', {
        mode,
        activeAgent,
        originalTask,
        conversationMessages,
        state: hookState,
        finalResponse: fullResponse,
      });
      if (stopOutcomes.some(outcome => outcome.allow === false)) {
        noToolCount = 0;
        continue;
      }

      return { finalResponse: fullResponse, completed: true, conversationMessages };
    }

    noToolCount++;
    if (displayContent || fullResponse.trim()) {
      callbacks?.onAssistantMessage?.(displayContent || fullResponse, activeAgent);
    }
    callbacks?.clearStreaming?.();

    if (mode === 'ask') {
      return { finalResponse: fullResponse, completed: false, conversationMessages };
    }
    if (mode === 'plan' && !parseToolCalls(fullResponse).calls.length) {
      return { finalResponse: fullResponse, completed: false, conversationMessages };
    }

    conversationMessages.push({ role: 'assistant', content: fullResponse });

    if (SEMANTIC_DONE_PATTERN.test(fullResponse)) {
      const stopOutcomes = await runHooks('Stop', {
        mode,
        activeAgent,
        originalTask,
        conversationMessages,
        state: hookState,
        finalResponse: fullResponse,
      });
      if (stopOutcomes.some(outcome => outcome.allow === false)) {
        noToolCount = 0;
        continue;
      }
      return { finalResponse: fullResponse, completed: true, conversationMessages };
    }

    const isRefusal = /I(?:'m| am) sorry|cannot assist|can't assist|unable to|I can't help/i.test(fullResponse);
    const recentHadError = conversationMessages.slice(-4).some(
      m => m.role === 'user' && m.content.includes('ERROR:'),
    );

    if ((isRefusal || recentHadError) && noToolCount <= 1) {
      conversationMessages.push({
        role: 'user',
        content: isRefusal
          ? 'Do NOT refuse. You are a coding agent executing a task. If a tool failed, diagnose the error and try a different approach. Use your tools to fix the problem and continue.'
          : 'The tool encountered an error. Diagnose what went wrong and try a different approach. Use your tools — do not stop.',
      });
      continue;
    }

    if (noToolCount >= 2) {
      return { finalResponse: fullResponse, completed: false, conversationMessages };
    }

    conversationMessages.push({
      role: 'user',
      content: doneContinuationPrompt(iteration),
    });
  }

  callbacks?.onSystemMessage?.(
    `Reached ${maxIterations} iterations. Review the changes made so far.`,
    `${activeAgent}:system`,
  );

  return {
    finalResponse: '',
    completed: false,
    conversationMessages,
  };
}
