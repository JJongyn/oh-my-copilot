"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_AGENT_FACTORIES = void 0;
exports.resolveAgent = resolveAgent;
exports.listAgents = listAgents;
const prompts_1 = require("./prompts");
function makeFactory(name, description, promptTemplate, defaultModel, temperature = 0.3) {
    return {
        name,
        description,
        mode: 'all',
        create(model, overrides) {
            return {
                name,
                description,
                systemPrompt: promptTemplate,
                model: overrides?.model ?? model ?? defaultModel,
                temperature: overrides?.temperature ?? temperature,
                mode: 'all',
                ...overrides,
            };
        },
    };
}
exports.BUILTIN_AGENT_FACTORIES = {
    sisyphus: makeFactory('sisyphus', 'Persistent full-stack software engineer — primary coding agent', prompts_1.SISYPHUS_PROMPT, 'gpt-4o', 0.3),
    atlas: makeFactory('atlas', 'Orchestrator — breaks complex tasks into steps and coordinates execution', prompts_1.ATLAS_PROMPT, 'gpt-4o', 0.2),
    oracle: makeFactory('oracle', 'Expert analyst — answers deep technical questions and reviews architecture', prompts_1.ORACLE_PROMPT, 'gpt-4o', 0.5),
    librarian: makeFactory('librarian', 'Codebase navigator — finds and explains code structure and conventions', prompts_1.LIBRARIAN_PROMPT, 'gpt-4o-mini', 0.2),
    explore: makeFactory('explore', 'Fast codebase search specialist', prompts_1.EXPLORE_PROMPT, 'gpt-4o-mini', 0.1),
    hephaestus: makeFactory('hephaestus', 'Focused implementation agent — writes clean, working code', prompts_1.HEPHAESTUS_PROMPT, 'gpt-4o', 0.3),
};
function resolveAgent(agentName, model, cwd, sessionId, overrides) {
    const factory = exports.BUILTIN_AGENT_FACTORIES[agentName] ?? exports.BUILTIN_AGENT_FACTORIES['sisyphus'];
    const config = factory.create(model, overrides);
    const resolvedPrompt = (0, prompts_1.interpolatePrompt)(config.systemPrompt, { cwd, sessionId, model });
    return { ...config, resolvedPrompt };
}
function listAgents() {
    return Object.values(exports.BUILTIN_AGENT_FACTORIES).map(f => ({
        name: f.name,
        description: f.description,
    }));
}
