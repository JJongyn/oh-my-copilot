import type { ChatMessage } from '../provider/types';
import type { RuntimeMode, RuntimeToolResult, ToolCallLike } from './loop';

export type HookStage = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';

export interface RuntimeHookState {
  readFiles: Set<string>;
  modifiedFiles: Set<string>;
  verificationCommandsRun: number;
  explorationToolCalls: number;
  subagentCalls: number;
  reviewReadsAfterWrite: number;
}

export interface HookContext {
  mode: RuntimeMode;
  activeAgent: string;
  originalTask: string;
  conversationMessages: ChatMessage[];
  state: RuntimeHookState;
}

export interface UserPromptHookInput extends HookContext {
  userMessage: string;
}

export interface PreToolHookInput extends HookContext {
  call: ToolCallLike;
}

export interface PostToolHookInput extends HookContext {
  call: ToolCallLike;
  result: RuntimeToolResult;
}

export interface StopHookInput extends HookContext {
  finalResponse: string;
}

export interface HookOutcome {
  allow?: boolean;
  message?: string;
  injectMessages?: ChatMessage[];
}

export interface RuntimeHook {
  name: string;
  stage: HookStage;
  run(input: UserPromptHookInput | PreToolHookInput | PostToolHookInput | StopHookInput): HookOutcome | Promise<HookOutcome>;
}

function hasReadForTarget(state: RuntimeHookState, filePath: string): boolean {
  return state.readFiles.has(filePath);
}

function looksDangerousCommand(command: string): boolean {
  return /\brm\s+-rf\b|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+--\b/.test(command);
}

function looksVerificationCommand(command: string): boolean {
  return /\b(test|typecheck|build|compile|pytest|jest|vitest|bun test|npm test|cargo test)\b/.test(command);
}

function isExplorationTool(toolName: string): boolean {
  return toolName === 'read_file'
    || toolName === 'search_files'
    || toolName === 'list_files'
    || toolName === 'git'
    || toolName === 'read_session'
    || toolName === 'list_sessions';
}

const REQUIRE_READ_BEFORE_WRITE: RuntimeHook = {
  name: 'require_read_before_write',
  stage: 'PreToolUse',
  run(input) {
    const { call, state } = input as PreToolHookInput;
    if (call.name !== 'write_file' && call.name !== 'edit_file') return {};
    const filePath = String(call.args.path ?? '');
    if (!filePath) return {};
    if (hasReadForTarget(state, filePath)) return {};
    return {
      allow: false,
      message: `Hook blocked ${call.name}: read_file must be called for "${filePath}" before modifying it.`,
    };
  },
};

const BLOCK_DANGEROUS_TERMINAL: RuntimeHook = {
  name: 'block_dangerous_terminal',
  stage: 'PreToolUse',
  run(input) {
    const { call } = input as PreToolHookInput;
    if (call.name !== 'run_terminal') return {};
    const command = String(call.args.command ?? '');
    if (!looksDangerousCommand(command)) return {};
    return {
      allow: false,
      message: `Hook blocked run_terminal: dangerous command detected: ${command}`,
    };
  },
};

const SUPERPOWERS_ULTRAWORK_KICKOFF: RuntimeHook = {
  name: 'superpowers_ultrawork_kickoff',
  stage: 'UserPromptSubmit',
  run(input) {
    const { mode } = input as UserPromptHookInput;
    if (mode !== 'ultrawork') return {};
    return {
      injectMessages: [{
        role: 'user',
        content: '[HOOK] Ultrawork follows a superpowers-style workflow: brainstorm the task, explore broadly, write down an execution checklist, delegate focused parallel subtasks when useful, implement surgically, then verify and review before DONE.',
      }],
    };
  },
};

const REQUIRE_EXPLORATION_BEFORE_WRITE_IN_ULTRAWORK: RuntimeHook = {
  name: 'require_exploration_before_write_in_ultrawork',
  stage: 'PreToolUse',
  run(input) {
    const { call, state, mode } = input as PreToolHookInput;
    if (mode !== 'ultrawork') return {};
    if (call.name !== 'write_file' && call.name !== 'edit_file') return {};
    if (state.explorationToolCalls >= 3) return {};
    return {
      allow: false,
      message: `Hook blocked ${call.name}: ultrawork requires at least 3 exploration actions before code changes.`,
      injectMessages: [{
        role: 'user',
        content: '[HOOK] Explore first. Use read/search/list tools to understand the codebase and form a concrete plan before editing.',
      }],
    };
  },
};

const TRACK_TOOL_STATE: RuntimeHook = {
  name: 'track_tool_state',
  stage: 'PostToolUse',
  run(input) {
    const { call, result, state } = input as PostToolHookInput;
    if (result.error) {
      return {
        injectMessages: [{
          role: 'user',
          content: `[HOOK] The last tool failed. Diagnose the cause from the error, avoid repeating the same call unchanged, and continue with a different approach.`,
        }],
      };
    }

    if (call.name === 'read_file') {
      const filePath = String(call.args.path ?? '');
      if (filePath) state.readFiles.add(filePath);
      if (state.modifiedFiles.has(filePath)) {
        state.reviewReadsAfterWrite += 1;
      }
    }
    if (call.name === 'write_file' || call.name === 'edit_file') {
      const filePath = String(call.args.path ?? '');
      if (filePath) state.modifiedFiles.add(filePath);
    }
    if (isExplorationTool(call.name)) {
      state.explorationToolCalls += 1;
    }
    if (call.name === 'call_agent' || call.name === 'spawn_agent') {
      state.subagentCalls += 1;
    }
    if (call.name === 'run_terminal') {
      const command = String(call.args.command ?? '');
      if (looksVerificationCommand(command)) {
        state.verificationCommandsRun += 1;
      }
    }
    return {};
  },
};

const REQUIRE_REVIEW_READ_BEFORE_STOP_IN_ULTRAWORK: RuntimeHook = {
  name: 'require_review_read_before_stop_in_ultrawork',
  stage: 'Stop',
  run(input) {
    const { state, mode } = input as StopHookInput;
    if (mode !== 'ultrawork') return {};
    if (state.modifiedFiles.size === 0) return {};
    if (state.reviewReadsAfterWrite > 0) return {};
    return {
      allow: false,
      message: 'Hook blocked completion: ultrawork requires reading back at least one modified file before finishing.',
      injectMessages: [{
        role: 'user',
        content: '[HOOK] Before DONE, read back the modified files and confirm the actual on-disk result matches the request.',
      }],
    };
  },
};

const REQUIRE_VERIFICATION_BEFORE_STOP: RuntimeHook = {
  name: 'require_verification_before_stop',
  stage: 'Stop',
  run(input) {
    const { state, mode } = input as StopHookInput;
    if (mode === 'ask' || mode === 'plan') return {};
    if (state.modifiedFiles.size === 0) return {};
    if (state.verificationCommandsRun > 0) return {};
    return {
      allow: false,
      message: 'Hook blocked completion: file changes were made but no verification command was run. Execute build/test/typecheck before finishing.',
      injectMessages: [{
        role: 'user',
        content: '[HOOK] You changed files but have not run verification yet. Run the relevant build, test, or typecheck command before outputting <promise>DONE</promise>.',
      }],
    };
  },
};

const ENCOURAGE_EXPLORATION_ON_OPEN_TASK: RuntimeHook = {
  name: 'encourage_exploration_on_open_task',
  stage: 'UserPromptSubmit',
  run(input) {
    const { userMessage, mode } = input as UserPromptHookInput;
    if (mode === 'ask') return {};
    if (!/\b(improve|refactor|clean up|optimize|review)\b/i.test(userMessage)) return {};
    return {
      injectMessages: [{
        role: 'user',
        content: '[HOOK] This is an open-ended task. Explore the relevant files and patterns before making changes, and keep scope tight.',
      }],
    };
  },
};

const BUILTIN_HOOKS: RuntimeHook[] = [
  SUPERPOWERS_ULTRAWORK_KICKOFF,
  ENCOURAGE_EXPLORATION_ON_OPEN_TASK,
  REQUIRE_EXPLORATION_BEFORE_WRITE_IN_ULTRAWORK,
  REQUIRE_READ_BEFORE_WRITE,
  BLOCK_DANGEROUS_TERMINAL,
  TRACK_TOOL_STATE,
  REQUIRE_REVIEW_READ_BEFORE_STOP_IN_ULTRAWORK,
  REQUIRE_VERIFICATION_BEFORE_STOP,
];

export const BUILTIN_HOOK_NAMES = BUILTIN_HOOKS.map(hook => hook.name);

export function createRuntimeHookState(): RuntimeHookState {
  return {
    readFiles: new Set<string>(),
    modifiedFiles: new Set<string>(),
    verificationCommandsRun: 0,
    explorationToolCalls: 0,
    subagentCalls: 0,
    reviewReadsAfterWrite: 0,
  };
}

export function resolveHooks(enabled: boolean, disabledNames: string[] = []): RuntimeHook[] {
  if (!enabled) return [];
  const disabled = new Set(disabledNames);
  return BUILTIN_HOOKS.filter(hook => !disabled.has(hook.name));
}
