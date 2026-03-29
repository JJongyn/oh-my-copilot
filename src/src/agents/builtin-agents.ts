import type { AgentConfig, AgentFactory, AgentCost } from './types';
import { loadConfig } from '../config/config-manager';
import {
  BASIC_PROMPT,
  SISYPHUS_PROMPT,
  ATLAS_PROMPT,
  ORACLE_PROMPT,
  LIBRARIAN_PROMPT,
  EXPLORE_PROMPT,
  HEPHAESTUS_PROMPT,
  PROMETHEUS_PROMPT,
  METIS_PROMPT,
  MOMUS_PROMPT,
  interpolatePrompt,
} from './prompts';

interface FactoryOpts {
  name: string;
  description: string;
  promptTemplate: string;
  defaultModel: string;
  temperature?: number;
  mode?: AgentConfig['mode'];
  cost?: AgentCost;
  readOnly?: boolean;
  deniedTools?: string[];
  recommendedSkills?: string[];
  preferredCapabilities?: string[];
}

function makeFactory(opts: FactoryOpts): AgentFactory {
  const {
    name,
    description,
    promptTemplate,
    defaultModel,
    temperature = 0.3,
    mode = 'all',
    cost = 'expensive',
    readOnly = false,
    deniedTools,
    recommendedSkills,
    preferredCapabilities,
  } = opts;

  return {
    name,
    description,
    mode,
    cost,
    create(model: string, overrides?: Partial<AgentConfig>): AgentConfig {
      return {
        name,
        description,
        systemPrompt: promptTemplate,
        model: overrides?.model ?? model ?? defaultModel,
        temperature: overrides?.temperature ?? temperature,
        mode,
        cost,
        readOnly,
        deniedTools,
        recommendedSkills,
        preferredCapabilities,
        ...overrides,
      };
    },
  };
}

export const BUILTIN_AGENT_FACTORIES: Record<string, AgentFactory> = {
  // ─── Primary Agents (appear in UI picker) ──────────────────────────────────
  basic: makeFactory({
    name: 'basic',
    description: 'Minimal assistant — closest to plain Copilot Chat behavior',
    promptTemplate: BASIC_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.2,
    mode: 'primary',
    cost: 'cheap',
  }),
  sisyphus: makeFactory({
    name: 'sisyphus',
    description: 'Primary orchestrator — plans, delegates, executes, verifies',
    promptTemplate: SISYPHUS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.1,
    mode: 'primary',
    cost: 'expensive',
    recommendedSkills: ['git-master'],
    preferredCapabilities: ['search', 'docs', 'github'],
  }),
  prometheus: makeFactory({
    name: 'prometheus',
    description: 'Strategic planner — interviews users, generates execution plans',
    promptTemplate: PROMETHEUS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.1,
    mode: 'primary',
    cost: 'expensive',
    preferredCapabilities: ['docs', 'search'],
  }),
  hephaestus: makeFactory({
    name: 'hephaestus',
    description: 'Deep worker — autonomous end-to-end implementation',
    promptTemplate: HEPHAESTUS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.3,
    mode: 'all',
    cost: 'expensive',
    recommendedSkills: ['playwright'],
    preferredCapabilities: ['browser', 'search'],
  }),

  // ─── Subagents (invoked by primary agents, not shown in main picker) ───────
  oracle: makeFactory({
    name: 'oracle',
    description: 'Architecture advisor — critical review, verification, analysis',
    promptTemplate: ORACLE_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.5,
    mode: 'all',
    cost: 'expensive',
    readOnly: true,
    deniedTools: ['write_file', 'edit_file', 'run_terminal'],
    preferredCapabilities: ['docs', 'search', 'github'],
  }),
  atlas: makeFactory({
    name: 'atlas',
    description: 'Todo-list coordinator — tracks progress across complex tasks',
    promptTemplate: ATLAS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.2,
    mode: 'subagent',
    cost: 'cheap',
    preferredCapabilities: ['search', 'github'],
  }),
  metis: makeFactory({
    name: 'metis',
    description: 'Scope reviewer — catches AI-slop and scope creep before planning',
    promptTemplate: METIS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.3,
    mode: 'subagent',
    cost: 'expensive',
    readOnly: true,
    preferredCapabilities: ['search'],
  }),
  momus: makeFactory({
    name: 'momus',
    description: 'Plan verifier — validates executability of plans',
    promptTemplate: MOMUS_PROMPT,
    defaultModel: 'gpt-5-mini',
    temperature: 0.1,
    mode: 'subagent',
    cost: 'cheap',
    readOnly: true,
    preferredCapabilities: ['docs', 'github'],
  }),
  librarian: makeFactory({
    name: 'librarian',
    description: 'Documentation researcher — finds and explains code patterns',
    promptTemplate: LIBRARIAN_PROMPT,
    defaultModel: 'gpt-4o-mini',
    temperature: 0.2,
    mode: 'subagent',
    cost: 'cheap',
    readOnly: true,
    preferredCapabilities: ['docs', 'search'],
  }),
  explore: makeFactory({
    name: 'explore',
    description: 'Fast codebase search — finds files, functions, and patterns',
    promptTemplate: EXPLORE_PROMPT,
    defaultModel: 'gpt-4o-mini',
    temperature: 0.1,
    mode: 'subagent',
    cost: 'free',
    readOnly: true,
    preferredCapabilities: ['search', 'github'],
  }),
};

export function resolveAgent(
  agentName: string,
  model: string,
  cwd: string,
  sessionId: string,
  overrides?: Partial<AgentConfig>,
): AgentConfig & { resolvedPrompt: string } {
  const factory = BUILTIN_AGENT_FACTORIES[agentName] ?? BUILTIN_AGENT_FACTORIES['sisyphus'];
  const repoConfig = loadConfig(cwd);
  const agentOverride = repoConfig.agents?.[agentName];
  const baseConfig = factory.create(model);
  const config = factory.create(model, {
    ...agentOverride,
    ...overrides,
    model: overrides?.model ?? agentOverride?.model ?? model,
    systemPrompt: overrides?.systemPrompt ?? agentOverride?.systemPrompt ?? baseConfig.systemPrompt,
    temperature: overrides?.temperature ?? agentOverride?.temperature ?? baseConfig.temperature,
  });
  if (agentOverride?.promptAppend) {
    config.systemPrompt = `${config.systemPrompt}\n\n${agentOverride.promptAppend}`;
  }
  const resolvedPrompt = interpolatePrompt(config.systemPrompt, { cwd, sessionId, model });
  return { ...config, resolvedPrompt };
}

export function listAgents(cwd: string = process.cwd()): Array<{ name: string; description: string; mode: string; cost?: string }> {
  const disabled = new Set(loadConfig(cwd).disabledAgents ?? []);
  return Object.values(BUILTIN_AGENT_FACTORIES)
    .filter(f => !disabled.has(f.name))
    .map(f => ({
      name: f.name,
      description: f.description,
      mode: f.mode,
      cost: f.cost,
    }));
}

/** List only agents that should appear in the UI agent picker */
export function listPrimaryAgents(cwd: string = process.cwd()): Array<{ name: string; description: string }> {
  const disabled = new Set(loadConfig(cwd).disabledAgents ?? []);
  return Object.values(BUILTIN_AGENT_FACTORIES)
    .filter(f => !disabled.has(f.name))
    .filter(f => f.mode === 'primary' || f.mode === 'all')
    .map(f => ({ name: f.name, description: f.description }));
}
