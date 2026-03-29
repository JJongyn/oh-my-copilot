import type { BridgeInfo, ChatMessage, ChatCompletionOptions, ChatStreamChunk, ModelInfo } from './types';
export declare class BridgeConnectionError extends Error {
    constructor(message: string);
}
export declare function readBridgeInfo(): BridgeInfo | null;
export declare class CopilotBridgeProvider {
    private baseUrl;
    private token;
    constructor(info: BridgeInfo);
    static fromBridgeFile(): CopilotBridgeProvider;
    private authHeaders;
    checkHealth(): Promise<boolean>;
    listModels(): Promise<ModelInfo[]>;
    streamChat(messages: ChatMessage[], options?: ChatCompletionOptions): AsyncGenerator<ChatStreamChunk>;
    completeChat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
}
