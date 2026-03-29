import type { AgentConfig, AgentFactory } from './types';
export declare const BUILTIN_AGENT_FACTORIES: Record<string, AgentFactory>;
export declare function resolveAgent(agentName: string, model: string, cwd: string, sessionId: string, overrides?: Partial<AgentConfig>): AgentConfig & {
    resolvedPrompt: string;
};
export declare function listAgents(): Array<{
    name: string;
    description: string;
}>;
