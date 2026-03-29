import React from 'react';
import { Box, Text, Static } from 'ink';
import type { Message } from '../hooks/useChat';

interface MessageItemProps {
  message: Message;
  width: number;
}

// ─── Tool Style Map ───────────────────────────────────────────────────────────

const TOOL_STYLE: Record<string, { label: string; color: string }> = {
  read_file:    { label: 'Read',   color: 'blue' },
  write_file:   { label: 'Write',  color: 'green' },
  edit_file:    { label: 'Edit',   color: 'yellow' },
  search_files: { label: 'Search', color: 'cyan' },
  list_files:   { label: 'List',   color: 'cyan' },
  run_terminal: { label: 'Bash',   color: 'green' },
  git:          { label: 'Git',    color: 'magenta' },
  call_agent:   { label: 'Agent',  color: 'magenta' },
  spawn_agent:  { label: 'Spawn',  color: 'magenta' },
  list_background_agents: { label: 'BG List', color: 'gray' },
  read_background_agent: { label: 'BG Read', color: 'gray' },
  list_sessions: { label: 'Sessions', color: 'blue' },
  read_session: { label: 'Session', color: 'blue' },
  harness: { label: 'Harness', color: 'magenta' },
};

function clampText(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(0, max - 3)) + '...' : text;
}

function HeaderLine({
  color,
  label,
  meta,
}: {
  color: string;
  label: string;
  meta?: string;
}) {
  return (
    <Box gap={1}>
      <Text color={color} bold>{label}</Text>
      {meta ? <Text color="gray" dimColor>{meta}</Text> : null}
    </Box>
  );
}

// ─── Markdown Line Renderer ───────────────────────────────────────────────────

/**
 * Renders a single line of inline markdown as React nodes.
 * Handles: ### headers, ## headers, - bullets, **bold**, `inline code`.
 */
function renderMarkdownLine(line: string, key: string | number): React.ReactNode {
  // H3: ### ...
  if (/^###\s+/.test(line)) {
    const text = line.replace(/^###\s+/, '');
    return (
      <Text key={key} bold color="cyan">{text}</Text>
    );
  }

  // H2: ## ...
  if (/^##\s+/.test(line)) {
    const text = line.replace(/^##\s+/, '');
    return (
      <Text key={key} bold color="white">{text}</Text>
    );
  }

  // H1: # ...
  if (/^#\s+/.test(line)) {
    const text = line.replace(/^#\s+/, '');
    return (
      <Text key={key} bold color="white">{text}</Text>
    );
  }

  // Bullet: - item or * item
  if (/^[-*]\s+/.test(line)) {
    const text = line.replace(/^[-*]\s+/, '');
    return (
      <Box key={key} flexDirection="row" gap={1}>
        <Text color="gray" dimColor>{'·'}</Text>
        <Text>{renderInlineMarkdown(text)}</Text>
      </Box>
    );
  }

  // Empty line
  if (line.trim() === '') {
    return <Text key={key}>{' '}</Text>;
  }

  // Normal line with inline markdown
  return (
    <Text key={key} wrap="wrap">{renderInlineMarkdown(line)}</Text>
  );
}

/**
 * Splits a line into segments of plain text, **bold**, and `inline code`.
 * Returns an array of React nodes.
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  // Pattern: **bold** or `code`
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);

  if (parts.length === 1) return text;

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <Text key={i} bold>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <Text key={i} color="yellow" dimColor>{part.slice(1, -1)}</Text>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

/**
 * Renders full markdown text, handling code blocks (``` fences) and per-line markdown.
 */
function renderMarkdown(content: string, width: number): React.ReactNode {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Opening code fence
    if (!inCodeBlock && /^```/.test(line)) {
      inCodeBlock = true;
      codeLang = line.replace(/^```/, '').trim();
      const label = codeLang ? `─ ${codeLang} ` : '─';
      nodes.push(
        <Text key={`fence-open-${i}`} color="gray" dimColor>{`  ┌${label}${'─'.repeat(Math.max(0, Math.min(width - 16, 20) - label.length))}┐`}</Text>
      );
      continue;
    }

    // Closing code fence
    if (inCodeBlock && /^```/.test(line)) {
      inCodeBlock = false;
      codeLang = '';
      nodes.push(
        <Text key={`fence-close-${i}`} color="gray" dimColor>{`  └${'─'.repeat(Math.min(width - 8, 22))}┘`}</Text>
      );
      continue;
    }

    // Code block content
    if (inCodeBlock) {
      nodes.push(
        <Text key={`code-${i}`} color="gray" dimColor wrap="wrap">{'  ' + line}</Text>
      );
      continue;
    }

    nodes.push(renderMarkdownLine(line, `line-${i}`));
  }

  return <>{nodes}</>;
}

// ─── User Message ─────────────────────────────────────────────────────────────

function UserMessage({ message, width }: MessageItemProps) {
  return (
    <Box flexDirection="column" marginBottom={1} width={width} borderStyle="single" borderColor="green" paddingX={1}>
      <HeaderLine color="green" label="You" />
      <Box paddingLeft={1}>
        <Text wrap="wrap">{clampText(message.content, width * 6)}</Text>
      </Box>
    </Box>
  );
}

// ─── Tool Message ─────────────────────────────────────────────────────────────

function extractToolName(content: string): string {
  const m = content.match(/\[tool:(\S+)\]/);
  return m ? (m[1] ?? 'tool') : 'tool';
}

function ToolMessage({ message, width }: MessageItemProps) {
  const content = message.content ?? '';
  const isError = content.includes(' ERROR:') || content.includes('Error:');
  const toolName = message.toolName ?? extractToolName(content);
  const style = TOOL_STYLE[toolName] ?? { label: toolName, color: 'gray' };

  const allLines = content.split('\n');
  const firstLine = allLines[0] ?? '';

  // Detail: strip [tool:xxx] prefix, also handle file paths / commands
  const rawDetail = firstLine.replace(/^\[tool:\w+\]\s*/, '').trim();
  // Smart truncation: keep file path + context, max ~width-20 chars
  const detail = rawDetail.length > width - 20 ? rawDetail.slice(0, width - 23) + '...' : rawDetail;

  // Show up to 4 output lines (lines 1-4), dimmed
  const outputLines = allLines.slice(1, 5);
  const extraCount = allLines.length - 5;

  return (
    <Box flexDirection="column" width={width} marginBottom={1} borderStyle="single" borderColor={isError ? 'red' : 'gray'} paddingX={1}>
      <HeaderLine
        color={isError ? 'red' : style.color}
        label={`Tool · ${style.label}`}
        meta={detail}
      />
      {outputLines.length > 0 && (
        <Box flexDirection="column" paddingLeft={1}>
          {outputLines.map((line, i) => {
            const cleaned = line.replace(/^\[tool:\w+\]\s*/, '');
            const truncated = clampText(cleaned, width - 8);
            return (
              <Text key={i} color={isError ? 'red' : 'gray'} dimColor wrap="wrap">
                {i + 1}{'│'} {truncated}
              </Text>
            );
          })}
          {extraCount > 0 && (
            <Text color="gray" dimColor>{`  (${extraCount} more lines)`}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─── Verification Message ─────────────────────────────────────────────────────

function VerificationMessage({ message, width }: MessageItemProps) {
  return (
    <Box width={width} marginBottom={1} borderStyle="single" borderColor="magenta" paddingX={1}>
      <HeaderLine color="magenta" label="Verify" />
      <Text color="magenta" dimColor wrap="wrap">{message.content}</Text>
    </Box>
  );
}

// ─── Oracle Verdict Message ───────────────────────────────────────────────────

function OracleVerdictMessage({ message, width }: MessageItemProps) {
  const content = message.content ?? '';
  const isPass = content.startsWith('✓') || /PASS/i.test(content.split('\n')[0] ?? '');
  const lines = content.split('\n');

  return (
    <Box
      flexDirection="column"
      width={width}
      marginBottom={1}
      borderStyle="round"
      borderColor={isPass ? 'green' : 'red'}
      paddingX={1}
    >
      <HeaderLine color={isPass ? 'green' : 'red'} label={isPass ? 'Oracle · PASS' : 'Oracle · FAIL'} />
      {lines.slice(1).filter(l => l.trim()).map((line, i) => (
        <Text key={i} color={isPass ? 'green' : 'red'} dimColor wrap="wrap">
          {line}
        </Text>
      ))}
    </Box>
  );
}

// ─── System Message ───────────────────────────────────────────────────────────

function SystemMessage({ message, width }: MessageItemProps) {
  return (
    <Box width={width} marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <HeaderLine color="gray" label="System" />
      <Text color="gray" dimColor wrap="wrap">{message.content}</Text>
    </Box>
  );
}

// ─── Assistant Message ────────────────────────────────────────────────────────

function AssistantMessage({ message, width }: MessageItemProps) {
  const rawLabel = message.agentName ?? 'assistant';

  if (rawLabel.endsWith(':tool')) {
    return <ToolMessage message={message} width={width} />;
  }
  if (rawLabel === 'oracle:verdict' || message.isOracleVerdict) {
    return <OracleVerdictMessage message={message} width={width} />;
  }
  if (rawLabel.endsWith(':verify') || message.isVerification) {
    return <VerificationMessage message={message} width={width} />;
  }
  if (rawLabel.endsWith(':system')) {
    return <SystemMessage message={message} width={width} />;
  }

  const displayName = rawLabel.split(':')[0] ?? rawLabel;

  return (
    <Box flexDirection="column" marginBottom={1} width={width} borderStyle="round" borderColor="cyan" paddingX={1}>
      <HeaderLine color="cyan" label={displayName} meta="assistant" />
      <Box paddingLeft={1} flexDirection="column">
        {renderMarkdown(message.content, width - 4)}
      </Box>
    </Box>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

const LOGO = [
  ' ██████╗ ██╗  ██╗     ███╗   ███╗██╗   ██╗',
  '██╔═══██╗██║  ██║     ████╗ ████║╚██╗ ██╔╝',
  '██║   ██║███████║     ██╔████╔██║ ╚████╔╝ ',
  '██║   ██║██╔══██║     ██║╚██╔╝██║  ╚██╔╝  ',
  '╚██████╔╝██║  ██║     ██║ ╚═╝ ██║   ██║   ',
  ' ╚═════╝ ╚═╝  ╚═╝     ╚═╝     ╚═╝   ╚═╝   ',
];

const LOGO_SUB = [
  ' ██████╗ ██████╗ ██████╗ ██╗██╗      ██████╗ ████████╗',
  '██╔════╝██╔═══██╗██╔══██╗██║██║     ██╔═══██╗╚══██╔══╝',
  '██║     ██║   ██║██████╔╝██║██║     ██║   ██║   ██║   ',
  '██║     ██║   ██║██╔═══╝ ██║██║     ██║   ██║   ██║   ',
  '╚██████╗╚██████╔╝██║     ██║███████╗╚██████╔╝   ██║   ',
  ' ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚═════╝    ╚═╝   ',
];

function WelcomeScreen({ width }: { width: number }) {
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((width - s.length) / 2));
    return ' '.repeat(pad) + s;
  };

  const showLogo = width >= 60;

  return (
    <Box flexDirection="column" width={width} marginBottom={1}>
      <Text> </Text>
      {showLogo ? (
        <>
          {LOGO.map((l, i) => (
            <Text key={`a${i}`} color="cyan" bold>{center(l)}</Text>
          ))}
          <Text> </Text>
          {LOGO_SUB.map((l, i) => (
            <Text key={`b${i}`} color="magenta">{center(l)}</Text>
          ))}
        </>
      ) : (
        <Box justifyContent="center" width={width}>
          <Text bold color="cyan">OH-MY-</Text>
          <Text bold color="magenta">COPILOT</Text>
        </Box>
      )}

      <Text> </Text>
      <Box justifyContent="center" width={width}>
        <Text color="gray">Terminal AI Agent powered by </Text>
        <Text color="blue" bold>GitHub Copilot</Text>
      </Box>
      <Text color="gray">{center('─'.repeat(Math.min(48, width - 10)))}</Text>

      <Box justifyContent="center" width={width} gap={2}>
        <Box>
          <Text color="cyan" bold>/</Text>
          <Text color="gray" dimColor> commands</Text>
        </Box>
        <Text color="gray" dimColor>{'·'}</Text>
        <Box>
          <Text color="yellow" bold>Tab</Text>
          <Text color="gray" dimColor> agents</Text>
        </Box>
        <Text color="gray" dimColor>{'·'}</Text>
        <Box>
          <Text color="red" bold>^C</Text>
          <Text color="gray" dimColor> quit</Text>
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  );
}

// ─── Streaming Block ──────────────────────────────────────────────────────────

function StreamingBlock({
  content,
  agentName,
  width,
}: {
  content: string;
  agentName: string;
  width: number;
}) {
  const isToolExec = content.startsWith('[') && content.includes('] running:');
  const isThinking = content.startsWith('<thinking>') || content.startsWith('[thinking]');

  // Tool execution in progress
  if (isToolExec) {
    const match = content.match(/^\[(\d+)\] running:\s*(\S+)\s*(.*)/s);
    const iter = match?.[1] ?? '';
    const toolName = match?.[2] ?? 'tool';
    const args = match?.[3]?.trim() ?? '';
    const style = TOOL_STYLE[toolName] ?? { label: toolName, color: 'gray' };

    return (
      <Box flexDirection="column" marginBottom={1} width={width} borderStyle="round" borderColor="cyan" paddingX={1}>
        <HeaderLine color="cyan" label={agentName} meta="running tool" />
        <Box paddingLeft={1} gap={1}>
          <Text color={style.color}>{'⎿'}</Text>
          <Text color={style.color} bold>{style.label}</Text>
          {args ? <Text color="gray" dimColor>{args.slice(0, width - 25)}</Text> : null}
          <Text color="gray" dimColor>[{iter}]</Text>
        </Box>
      </Box>
    );
  }

  // Thinking mode
  if (isThinking) {
    const thinkContent = content
      .replace(/^<thinking>\s*/, '')
      .replace(/<\/thinking>\s*$/, '')
      .replace(/^\[thinking\]\s*/, '');

    return (
      <Box flexDirection="column" marginBottom={1} width={width} borderStyle="round" borderColor="magenta" paddingX={1}>
        <HeaderLine color="magenta" label={agentName} meta="thinking" />
        {thinkContent ? (
          <Box paddingLeft={1}>
            <Text wrap="wrap" color="gray" dimColor>{thinkContent.slice(0, 500)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  // Regular streaming — show last 200 chars dimmed
  const tail = content.length > 200 ? content.slice(-200) : content;

  return (
    <Box flexDirection="column" marginBottom={1} width={width} borderStyle="round" borderColor="yellow" paddingX={1}>
      <HeaderLine color="yellow" label={agentName} meta="streaming" />
      <Box paddingLeft={1} flexDirection="column">
        <Text wrap="wrap" dimColor>{tail}</Text>
      </Box>
    </Box>
  );
}

// ─── Message List (main export) ───────────────────────────────────────────────

export interface MessageListProps {
  completedMessages: Message[];
  streamingContent: string;
  agentName: string;
  width: number;
}

export function shouldRerenderMessageList(prev: MessageListProps, next: MessageListProps): boolean {
  return !(
    prev.completedMessages === next.completedMessages &&
    prev.streamingContent === next.streamingContent &&
    prev.agentName === next.agentName &&
    prev.width === next.width
  );
}

function MessageListInner({
  completedMessages,
  streamingContent,
  agentName,
  width,
}: MessageListProps) {
  const isEmpty = completedMessages.length === 0 && !streamingContent;

  return (
    <Box flexDirection="column" width={width} flexGrow={1} paddingY={1}>
      {isEmpty && <WelcomeScreen width={width} />}

      <Static items={completedMessages}>
        {(msg: Message) =>
          msg.role === 'user'
            ? <UserMessage key={msg.id} message={msg} width={width} />
            : <AssistantMessage key={msg.id} message={msg} width={width} />
        }
      </Static>

      {streamingContent ? (
        <StreamingBlock content={streamingContent} agentName={agentName} width={width} />
      ) : null}
    </Box>
  );
}

export const MessageList = React.memo(MessageListInner, (prev, next) => !shouldRerenderMessageList(prev, next));
