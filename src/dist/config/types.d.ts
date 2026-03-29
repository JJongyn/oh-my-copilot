export interface AgentOverrideConfig {
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    promptAppend?: string;
}
export interface McpServerConfig {
    type: 'stdio' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
}
export interface OhMyCopilotConfig {
    /** Override the default Copilot model (family name or model id) */
    model?: string;
    /** Per-agent model/prompt overrides */
    agents?: Record<string, AgentOverrideConfig>;
    /** Disable specific built-in agents */
    disabledAgents?: string[];
    /** MCP server configs */
    mcpServers?: Record<string, McpServerConfig>;
    /** Disable specific built-in MCPs */
    disabledMcps?: string[];
    /** Bridge connection info (auto-discovered from ~/.oh-my-copilot/bridge.json) */
    bridge?: {
        port?: number;
        token?: string;
    };
    /** Session settings */
    session?: {
        saveDir?: string;
        maxHistory?: number;
    };
}
