export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
  models: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ChatStreamChunk {
  content: string;
  done: boolean;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  vendor: string;
  maxInputTokens: number;
}

export interface BridgeToolInfo {
  name: string;
  description: string;
  tags: string[];
  inputSchema?: Record<string, unknown>;
}

export interface BridgeToolResultPart {
  type: 'text' | 'data' | 'json' | 'unknown';
  text?: string;
  mimeType?: string;
}
