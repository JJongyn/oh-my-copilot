import { describe, expect, test } from 'bun:test';
import type { Message } from '../src/ui/hooks/useChat';
import { shouldRerenderMessageList } from '../src/ui/components/MessageList';
import { shouldRerenderStatusBar } from '../src/ui/components/Header';
import { removeLastCodePoint } from '../src/ui/components/CustomTextInput';

describe('UI render stability helpers', () => {
  test('MessageList skips rerender when transcript props are unchanged', () => {
    const completedMessages: Message[] = [
      { id: '1', role: 'user', content: 'hello' },
    ];

    expect(shouldRerenderMessageList(
      {
        completedMessages,
        streamingContent: '',
        agentName: 'basic',
        width: 100,
      },
      {
        completedMessages,
        streamingContent: '',
        agentName: 'basic',
        width: 100,
      },
    )).toBe(false);
  });

  test('MessageList rerenders when streaming content changes', () => {
    const completedMessages: Message[] = [];

    expect(shouldRerenderMessageList(
      {
        completedMessages,
        streamingContent: '',
        agentName: 'basic',
        width: 100,
      },
      {
        completedMessages,
        streamingContent: 'thinking...',
        agentName: 'basic',
        width: 100,
      },
    )).toBe(true);
  });

  test('StatusBar skips rerender when status props are unchanged', () => {
    expect(shouldRerenderStatusBar(
      {
        agentName: 'basic',
        model: 'gpt-5-mini',
        copilotMode: 'agent',
        sessionId: 'session-1',
        status: 'idle',
        agentIteration: 0,
        loopPhase: 'done',
        mcpCount: 1,
        messageCount: 4,
        tokensUsed: 10,
        modelMaxTokens: 1000,
        currentTool: undefined,
        workingDirectory: '/tmp/project',
        width: 100,
      },
      {
        agentName: 'basic',
        model: 'gpt-5-mini',
        copilotMode: 'agent',
        sessionId: 'session-1',
        status: 'idle',
        agentIteration: 0,
        loopPhase: 'done',
        mcpCount: 1,
        messageCount: 4,
        tokensUsed: 10,
        modelMaxTokens: 1000,
        currentTool: undefined,
        workingDirectory: '/tmp/project',
        width: 100,
      },
    )).toBe(false);
  });

  test('StatusBar rerenders when active tool changes', () => {
    expect(shouldRerenderStatusBar(
      {
        agentName: 'basic',
        model: 'gpt-5-mini',
        copilotMode: 'agent',
        sessionId: 'session-1',
        status: 'streaming',
        agentIteration: 1,
        loopPhase: 'executing',
        mcpCount: 1,
        messageCount: 4,
        tokensUsed: 10,
        modelMaxTokens: 1000,
        currentTool: 'read_file',
        workingDirectory: '/tmp/project',
        width: 100,
      },
      {
        agentName: 'basic',
        model: 'gpt-5-mini',
        copilotMode: 'agent',
        sessionId: 'session-1',
        status: 'streaming',
        agentIteration: 1,
        loopPhase: 'executing',
        mcpCount: 1,
        messageCount: 4,
        tokensUsed: 10,
        modelMaxTokens: 1000,
        currentTool: 'edit_file',
        workingDirectory: '/tmp/project',
        width: 100,
      },
    )).toBe(true);
  });
  test('CustomTextInput removes whole unicode codepoints on backspace', () => {
    expect(removeLastCodePoint('hello')).toBe('hell');
    expect(removeLastCodePoint('한글')).toBe('한');
  });
});
