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
}
export interface ChatStreamChunk {
    content: string;
    done: boolean;
}
export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
}
