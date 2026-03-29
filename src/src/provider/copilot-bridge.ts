import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  BridgeInfo,
  BridgeToolInfo,
  BridgeToolResultPart,
  ChatMessage,
  ChatCompletionOptions,
  ChatStreamChunk,
  ModelInfo,
} from './types';

const BRIDGE_INFO_PATH = path.join(os.homedir(), '.oh-my-copilot', 'bridge.json');

export class BridgeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeConnectionError';
  }
}

export function readBridgeInfo(): BridgeInfo | null {
  try {
    if (!fs.existsSync(BRIDGE_INFO_PATH)) return null;
    return JSON.parse(fs.readFileSync(BRIDGE_INFO_PATH, 'utf-8')) as BridgeInfo;
  } catch {
    return null;
  }
}

export class CopilotBridgeProvider {
  private baseUrl: string;
  private token: string;

  constructor(info: BridgeInfo) {
    this.baseUrl = `http://127.0.0.1:${info.port}`;
    this.token = info.token;
  }

  static fromBridgeFile(): CopilotBridgeProvider {
    const info = readBridgeInfo();
    if (!info) {
      throw new BridgeConnectionError(
        `Bridge info not found at ${BRIDGE_INFO_PATH}.\n` +
        `Please open VSCode with the oh-my-copilot-bridge extension installed and active.`
      );
    }
    return new CopilotBridgeProvider(info);
  }

  private authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const resp = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.authHeaders(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new BridgeConnectionError(`Failed to list models (${resp.status}): ${text}`);
    }
    const data = await resp.json() as { data: ModelInfo[] };
    return data.data;
  }

  async listEditorTools(): Promise<BridgeToolInfo[]> {
    const resp = await fetch(`${this.baseUrl}/v1/tools`, {
      headers: this.authHeaders(),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new BridgeConnectionError(`Failed to list editor tools (${resp.status}): ${text}`);
    }
    const data = await resp.json() as { data: BridgeToolInfo[] };
    return data.data;
  }

  async callEditorTool(name: string, input: Record<string, unknown>): Promise<BridgeToolResultPart[]> {
    const resp = await fetch(`${this.baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name, input }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new BridgeConnectionError(`Editor tool call failed (${resp.status}): ${text}`);
    }
    const data = await resp.json() as { content: BridgeToolResultPart[] };
    return data.content;
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<ChatStreamChunk> {
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      signal: options.signal,
      body: JSON.stringify({
        model: options.model ?? 'gpt-5-mini',
        messages,
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new BridgeConnectionError(`Chat request failed (${resp.status}): ${text}`);
    }

    if (!resp.body) {
      throw new BridgeConnectionError('No response body from bridge');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ':') continue;

        if (trimmed === 'data: [DONE]') {
          yield { content: '', done: true };
          return;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices?.[0]?.delta?.content ?? '';
            if (content) {
              yield { content, done: false };
            }
            // Capture usage from final chunk (sent by bridge with finish_reason: 'stop')
            if (json.usage) {
              yield {
                content: '',
                done: false,
                usage: {
                  promptTokens: json.usage.prompt_tokens ?? 0,
                  completionTokens: json.usage.completion_tokens ?? 0,
                  totalTokens: json.usage.total_tokens ?? 0,
                },
              };
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    }
  }

  async getCopilotUsage(): Promise<{
    requests: number;
    tokens: number;
    user?: string;
    quota?: {
      chatMessages: { used: number; limit: number | null } | null;
      codeCompletions: { used: number; limit: number | null } | null;
    };
  } | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/copilot/usage`, {
        headers: this.authHeaders(),
      });
      if (!resp.ok) return null;
      return await resp.json() as {
        requests: number;
        tokens: number;
        user?: string;
        quota?: {
          chatMessages: { used: number; limit: number | null } | null;
          codeCompletions: { used: number; limit: number | null } | null;
        };
      };
    } catch {
      return null;
    }
  }

  async completeChat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    let result = '';
    for await (const chunk of this.streamChat(messages, { ...options, stream: true })) {
      result += chunk.content;
    }
    return result;
  }
}
