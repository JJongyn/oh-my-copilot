import type { ChatMessage } from '../provider/types';
export type AgentMode = 'primary' | 'subagent' | 'all';
export interface AgentContext {
    cwd: string;
    model: string;
    sessionId: string;
    history: ChatMessage[];
}
export interface AgentConfig {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
    temperature?: number;
    mode: AgentMode;
}
export interface AgentFactory {
    create(model: string, overrides?: Partial<AgentConfig>): AgentConfig;
    mode: AgentMode;
    name: string;
    description: string;
}
export type BuiltinAgentName = 'sisyphus' | 'atlas' | 'oracle' | 'librarian' | 'explore' | 'hephaestus';
