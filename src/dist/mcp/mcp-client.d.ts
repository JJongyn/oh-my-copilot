import type { McpServerConfig } from '../config/types';
export interface McpTool {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
}
export interface McpToolResult {
    content: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
}
export declare class McpClientManager {
    private clients;
    private tools;
    connectServer(name: string, config: McpServerConfig): Promise<void>;
    connectAll(servers: Record<string, McpServerConfig>): Promise<{
        name: string;
        error: string;
    }[]>;
    listTools(): McpTool[];
    callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult>;
    getToolsAsOpenAIFunctions(): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
    disconnectAll(): Promise<void>;
}
