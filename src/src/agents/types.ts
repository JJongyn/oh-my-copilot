import type { ChatMessage } from '../provider/types';

export type AgentMode = 'primary' | 'subagent' | 'all';

/** Cost tier — affects model selection and routing */
export type AgentCost = 'free' | 'cheap' | 'expensive';

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
  cost?: AgentCost;
  /** Tools this agent is NOT allowed to use */
  deniedTools?: string[];
  /** If true, agent operates read-only (no write_file, edit_file, run_terminal) */
  readOnly?: boolean;
  /** Max token budget for extended thinking (Oracle, Metis) */
  thinkingBudget?: number;
  /** Optional built-in skill suggestions for this agent */
  recommendedSkills?: string[];
  /** Optional capability focus keywords for editor tools / MCP */
  preferredCapabilities?: string[];
}

export interface AgentFactory {
  create(model: string, overrides?: Partial<AgentConfig>): AgentConfig;
  mode: AgentMode;
  name: string;
  description: string;
  cost?: AgentCost;
}

/**
 * Delegation contract — every subagent call from Sisyphus must include these fields.
 * Mirrors oh-my-openagent's six-section delegation pattern.
 */
export interface DelegationContract {
  task: string;
  expectedOutcome: string;
  requiredTools: string[];
  mustDo: string[];
  mustNot: string[];
  context: string;
}

export type BuiltinAgentName =
  | 'basic'
  | 'sisyphus'
  | 'atlas'
  | 'oracle'
  | 'librarian'
  | 'explore'
  | 'hephaestus'
  | 'prometheus'
  | 'metis'
  | 'momus';
