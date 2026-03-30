import React from 'react';
import { Box, Text } from 'ink';
import * as os from 'os';
import type { Status, CopilotMode, LoopPhase } from '../hooks/useChat';

export interface StatusBarProps {
  agentName: string;
  model: string;
  copilotMode: CopilotMode;
  harnessTeamName?: string;
  sessionId: string;
  status: Status;
  agentIteration?: number;
  loopPhase?: LoopPhase;
  mcpCount?: number;
  messageCount?: number;
  tokensUsed?: number;
  modelMaxTokens?: number;
  currentTool?: string;
  workingDirectory: string;
  width: number;
}

const MODE_COLOR: Record<CopilotMode, string> = {
  ask: 'cyan',
  plan: 'yellow',
  agent: 'green',
  ultrawork: 'magenta',
  harness: 'magenta',
};

const MODE_ICON: Record<CopilotMode, string> = {
  ask: '?',
  plan: '≡',
  agent: '▸',
  ultrawork: '≫',
  harness: '⌘',
};

const PHASE_LABEL: Record<LoopPhase, { text: string; color: string }> = {
  executing: { text: 'working', color: 'yellow' },
  verifying: { text: 'verifying', color: 'magenta' },
  fixing: { text: 'fixing', color: 'red' },
  done: { text: 'ready', color: 'green' },
};

const TOOL_SHORT: Record<string, string> = {
  read_file:    'read',
  write_file:   'write',
  edit_file:    'edit',
  search_files: 'search',
  list_files:   'list',
  run_terminal: 'run',
  git:          'git',
  call_agent:   'agent',
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatWorkingDirectory(cwd: string, width: number): string {
  const home = os.homedir();
  const normalized = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const maxWidth = Math.max(18, width - 8);
  if (normalized.length <= maxWidth) return normalized;
  return `...${normalized.slice(-(maxWidth - 3))}`;
}

export function shouldRerenderStatusBar(prev: StatusBarProps, next: StatusBarProps): boolean {
  return !(
    prev.agentName === next.agentName &&
    prev.model === next.model &&
    prev.copilotMode === next.copilotMode &&
    prev.harnessTeamName === next.harnessTeamName &&
    prev.sessionId === next.sessionId &&
    prev.status === next.status &&
    prev.agentIteration === next.agentIteration &&
    prev.loopPhase === next.loopPhase &&
    prev.mcpCount === next.mcpCount &&
    prev.messageCount === next.messageCount &&
    prev.tokensUsed === next.tokensUsed &&
    prev.modelMaxTokens === next.modelMaxTokens &&
    prev.currentTool === next.currentTool &&
    prev.workingDirectory === next.workingDirectory &&
    prev.width === next.width
  );
}

function StatusBarInner({
  agentName,
  model,
  copilotMode,
  harnessTeamName,
  sessionId,
  status,
  agentIteration = 0,
  loopPhase = 'done',
  mcpCount = 0,
  messageCount,
  tokensUsed = 0,
  modelMaxTokens = 0,
  currentTool,
  workingDirectory,
  width,
}: StatusBarProps) {
  const shortId = sessionId.slice(0, 8);
  const shortModel = model.split('/').pop() ?? model;

  const isStreaming = status === 'streaming';
  const isError = status === 'error';

  let statusColor: string;
  let statusDot: string;
  let statusText: string;

  if (isError) {
    statusColor = 'red';
    statusDot = '⊗';
    statusText = 'error';
  } else if (isStreaming) {
    statusColor = PHASE_LABEL[loopPhase].color;
    statusDot = '◉';
    statusText = agentIteration > 0
      ? `${PHASE_LABEL[loopPhase].text} ·${agentIteration}`
      : 'thinking';
  } else {
    statusColor = 'green';
    statusDot = '●';
    statusText = 'ready';
  }

  const displayName = copilotMode === 'ultrawork' ? 'auto' : agentName;
  const modeColor = MODE_COLOR[copilotMode];
  const modeIcon = MODE_ICON[copilotMode];
  const displayCwd = formatWorkingDirectory(workingDirectory, width);

  // Frame color pulses with current state — instant visual feedback
  const frameColor = isError ? 'red' : isStreaming ? statusColor : 'cyan';
  const toolLabel = currentTool ? (TOOL_SHORT[currentTool] ?? currentTool) : undefined;

  return (
    <Box flexDirection="column" width={width}>
      {/* Double-line frame — color reflects current state */}
      <Box width={width}>
        <Text color={frameColor} dimColor={!isError}>{'═'.repeat(width)}</Text>
      </Box>

      {/* Status bar content */}
      <Box width={width} paddingX={1} justifyContent="space-between">
        {/* Left: ◆ agent ╱ model ╱ mode [╱ ⎿ tool] */}
        <Box gap={0}>
          <Text color="magenta" bold>◆ </Text>
          <Text color="magenta" bold>{displayName}</Text>
          <Text color="gray" dimColor>  ╱  </Text>
          <Text color="blue">{shortModel}</Text>
          <Text color="gray" dimColor>  ╱  </Text>
          <Text color={modeColor} bold>{modeIcon} </Text>
          <Text color={modeColor}>{copilotMode}</Text>
          {copilotMode === 'harness' && harnessTeamName && (
            <>
              <Text color="gray" dimColor>  ╱  </Text>
              <Text color="magenta" dimColor>{harnessTeamName}</Text>
            </>
          )}
          {isStreaming && toolLabel && (
            <>
              <Text color="gray" dimColor>  ╱  </Text>
              <Text color={statusColor} dimColor>⎿ {toolLabel}</Text>
            </>
          )}
        </Box>

        {/* Right: tokens  msgs  id  ● status */}
        <Box gap={0}>
          {tokensUsed > 0 && (
            <Text color="cyan" dimColor>
              {modelMaxTokens > 0
                ? `${formatTokens(tokensUsed)}╱${formatTokens(modelMaxTokens)}`
                : formatTokens(tokensUsed)}
              {'  '}
            </Text>
          )}
          {messageCount !== undefined && messageCount > 0 && (
            <Text color="gray" dimColor>{messageCount}msg  </Text>
          )}
          {mcpCount > 0 && (
            <Text color="green" dimColor>mcp:{mcpCount}  </Text>
          )}
          <Text color="gray" dimColor>{shortId}  </Text>
          <Text color={statusColor} bold>{statusDot} </Text>
          <Text color={statusColor}>{statusText}</Text>
        </Box>
      </Box>
      <Box width={width} paddingX={1}>
        <Text color="gray" dimColor>{`cwd ${displayCwd}`}</Text>
      </Box>
    </Box>
  );
}

export const StatusBar = React.memo(StatusBarInner, (prev, next) => !shouldRerenderStatusBar(prev, next));
export { StatusBar as Header };
export type { StatusBarProps as HeaderProps };
