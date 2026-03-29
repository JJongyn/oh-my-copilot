import * as fs from 'fs';
import * as path from 'path';
import { analyzeProject } from '../init/project-analyzer';
import { listAgents } from '../agents/builtin-agents';
import { loadSkills } from '../skills/skill-loader';
import type { ChatMessage } from '../provider/types';
import type { HarnessGeneratedAgent, HarnessGeneratedSkill, HarnessPattern, HarnessTeam } from './types';

interface HarnessPlannerProvider {
  completeChat(messages: ChatMessage[], options?: { model?: string }): Promise<string>;
}

interface HarnessAgentPlan {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
}

interface HarnessSkillPlan {
  name: string;
  description: string;
  preferredAgent: string;
  systemPrompt: string;
  tags?: string[];
}

interface HarnessPlan {
  teamName: string;
  pattern: HarnessPattern;
  summary: string;
  recommendedExecutor: string;
  agents: HarnessAgentPlan[];
  skills: HarnessSkillPlan[];
}

export class HarnessGenerationError extends Error {
  constructor(
    public readonly code:
      | 'quota_exceeded'
      | 'rate_limited'
      | 'bridge_unavailable'
      | 'authentication_failed'
      | 'planner_failed',
    message: string,
  ) {
    super(message);
    this.name = 'HarnessGenerationError';
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

function detectProjectName(cwd: string): string {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const name = typeof pkg.name === 'string' ? pkg.name : '';
      if (name.trim()) return slugify(name);
    }
  } catch {
    // ignore
  }
  return slugify(path.basename(cwd));
}

function choosePattern(sourceFileCount: number, hasTests: boolean): HarnessPattern {
  if (sourceFileCount > 120) return 'supervisor';
  if (sourceFileCount > 50) return 'fan-out-fan-in';
  if (hasTests) return 'producer-reviewer';
  return 'pipeline';
}

function chooseExecutor(pattern: HarnessPattern): string {
  if (pattern === 'supervisor' || pattern === 'hierarchical-delegation') return 'atlas';
  if (pattern === 'pipeline') return 'hephaestus';
  return 'sisyphus';
}

function isHarnessPattern(value: string): value is HarnessPattern {
  return ['producer-reviewer', 'fan-out-fan-in', 'supervisor', 'pipeline', 'hierarchical-delegation'].includes(value);
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractJsonObject(text: string): string | null {
  const fenced = stripCodeFences(text);
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return fenced.slice(start, end + 1);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isInsideRoot(targetPath: string, root: string): boolean {
  const resolved = path.resolve(targetPath);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

function writeIfChanged(filePath: string, content: string): void {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function removeIfOwned(filePath: string, cwd: string): void {
  if (!isInsideRoot(filePath, cwd)) return;
  if (!fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup failures
  }
}

function removeDirIfEmpty(dirPath: string, cwd: string): void {
  if (!isInsideRoot(dirPath, cwd)) return;
  if (!fs.existsSync(dirPath)) return;
  try {
    if (fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // ignore cleanup failures
  }
}

function buildAgentMd(name: string, description: string, systemPrompt: string, tools: string[] = ['*']): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'target: vscode',
    `tools: [${tools.map(tool => `"${tool}"`).join(', ')}]`,
    '---',
    '',
    systemPrompt.trim(),
    '',
  ].join('\n');
}

function buildSkillMd(title: string, body: string): string {
  return `${body.trim()}\n`;
}

function buildSkillJson(description: string, preferredAgent: string, tags: string[]): string {
  return `${JSON.stringify({ description, preferredAgent, tags }, null, 2)}\n`;
}

function buildHarnessPlanningPrompt(cwd: string): string {
  const analysis = analyzeProject(cwd);
  const builtinAgents = listAgents(cwd);
  const builtinSkills = loadSkills(cwd).map(skill => ({ name: skill.name, source: skill.source, description: skill.description }));

  return `You are Harness Architect for oh-my-copilot.

Design a project-specific agent team and skill set for the current repository.

Rules:
- Return JSON only
- Choose one pattern from: producer-reviewer, fan-out-fan-in, supervisor, pipeline, hierarchical-delegation
- recommendedExecutor must be one of the built-in agents listed below
- Generate 2 to 4 custom agents
- Generate 1 to 3 project-specific skills
- Keep names short, kebab-case, and project-specific
- The output must fit the current repository; do not invent external systems unless clearly implied
- Prefer practical implementation/review roles over abstract theory
- Make the generated team usable from harness mode immediately

Built-in executors and agents:
${builtinAgents.map(agent => `- ${agent.name}: ${agent.description}`).join('\n')}

Existing available skills:
${builtinSkills.map(skill => `- ${skill.name} (${skill.source}): ${skill.description ?? ''}`).join('\n')}

Project analysis:
${JSON.stringify(analysis, null, 2)}

Return exactly this JSON shape:
{
  "teamName": "string",
  "pattern": "producer-reviewer",
  "summary": "string",
  "recommendedExecutor": "sisyphus",
  "agents": [
    {
      "name": "string",
      "role": "planner|builder|reviewer|...",
      "description": "string",
      "systemPrompt": "string",
      "tools": ["read_file", "search_files"]
    }
  ],
  "skills": [
    {
      "name": "string",
      "description": "string",
      "preferredAgent": "generated-agent-name",
      "systemPrompt": "string",
      "tags": ["harness", "domain"]
    }
  ]
}`;
}

function normalizeToolList(tools?: string[]): string[] {
  const list = (tools ?? ['*']).map(tool => String(tool).trim()).filter(Boolean);
  return list.length > 0 ? Array.from(new Set(list)) : ['*'];
}

function fallbackPlan(cwd: string): HarnessPlan {
  const analysis = analyzeProject(cwd);
  const projectName = detectProjectName(cwd);
  const pattern = choosePattern(analysis.sourceFileCount, analysis.hasTests);
  const recommendedExecutor = chooseExecutor(pattern);
  const rolePrefix = projectName.replace(/-/g, ' ');
  const agentNames = {
    planner: `${projectName}-planner`,
    builder: `${projectName}-builder`,
    reviewer: `${projectName}-reviewer`,
  };

  return {
    teamName: `${projectName}-harness`,
    pattern,
    summary: `Generated harness team for ${projectName} using ${pattern} architecture`,
    recommendedExecutor,
    agents: [
      {
        name: agentNames.planner,
        role: 'planner',
        description: `${rolePrefix} planning specialist generated by harness`,
        systemPrompt: `You are ${agentNames.planner}, the project-specific planning specialist for ${projectName}.

Your role:
- Break down tasks for this repository into concrete implementation steps
- Identify files, constraints, and verification requirements before coding
- Prefer minimal scope and explicit handoff instructions
- Coordinate with ${agentNames.builder} for implementation and ${agentNames.reviewer} for review when useful

Output concise, actionable plans tied to the current codebase.`,
        tools: ['read_file', 'list_files', 'search_files', 'git', 'list_sessions', 'read_session'],
      },
      {
        name: agentNames.builder,
        role: 'builder',
        description: `${rolePrefix} implementation specialist generated by harness`,
        systemPrompt: `You are ${agentNames.builder}, the project-specific implementation worker for ${projectName}.

Your role:
- Implement requested changes using the repository's existing patterns
- Prefer surgical edits over broad rewrites
- Use generated skills and project context before making assumptions
- Verify changed files and hand off to ${agentNames.reviewer} when review is needed`,
        tools: ['*'],
      },
      {
        name: agentNames.reviewer,
        role: 'reviewer',
        description: `${rolePrefix} reviewer generated by harness`,
        systemPrompt: `You are ${agentNames.reviewer}, the project-specific reviewer for ${projectName}.

Your role:
- Review for correctness, regressions, and missing verification
- Focus on behavior and risk, not style nitpicks
- Use read-only investigation first, then give actionable findings
- Keep reviews concise and concrete`,
        tools: ['read_file', 'list_files', 'search_files', 'git', 'list_sessions', 'read_session'],
      },
    ],
    skills: [
      {
        name: `${projectName}-implementation`,
        description: `${projectName} implementation rules generated by harness`,
        preferredAgent: agentNames.builder,
        systemPrompt: `You are using the ${projectName}-implementation skill.

Use this skill to implement changes in ${projectName}.

When active:
- Respect existing project structure and conventions
- Prefer minimal edits with clear verification steps
- Keep implementation aligned with the generated harness team roles
- Hand off review-oriented concerns to the reviewer role rather than bloating the implementation`,
        tags: ['harness', 'implementation', projectName],
      },
      {
        name: `${projectName}-verification`,
        description: `${projectName} verification rules generated by harness`,
        preferredAgent: agentNames.reviewer,
        systemPrompt: `You are using the ${projectName}-verification skill.

Use this skill when validating or reviewing work in ${projectName}.

When active:
- Check requirements against changed files and verification output
- Prefer concrete findings with file references
- Ensure tests, builds, and project-specific checks are considered before completion`,
        tags: ['harness', 'verification', projectName],
      },
    ],
  };
}

function sanitizePlan(raw: HarnessPlan, cwd: string): HarnessPlan {
  const fallback = fallbackPlan(cwd);
  const projectName = detectProjectName(cwd);
  const builtinAgentNames = new Set(listAgents(cwd).map(agent => agent.name));

  const pattern = isHarnessPattern(raw.pattern) ? raw.pattern : fallback.pattern;
  const recommendedExecutor = builtinAgentNames.has(raw.recommendedExecutor) ? raw.recommendedExecutor : fallback.recommendedExecutor;
  const teamName = slugify(raw.teamName || fallback.teamName);

  const agents = (raw.agents?.length ? raw.agents : fallback.agents)
    .slice(0, 4)
    .map((agent, index) => ({
      name: slugify(agent.name || `${projectName}-agent-${index + 1}`),
      role: agent.role || `role-${index + 1}`,
      description: agent.description || `Generated agent ${index + 1} for ${projectName}`,
      systemPrompt: agent.systemPrompt || `You are ${agent.name || `${projectName}-agent-${index + 1}`}.`,
      tools: normalizeToolList(agent.tools),
    }));

  const fallbackAgentName = agents[0]?.name ?? fallback.agents[0].name;
  const agentNameSet = new Set(agents.map(agent => agent.name));

  const skills = (raw.skills?.length ? raw.skills : fallback.skills)
    .slice(0, 3)
    .map((skill, index) => ({
      name: slugify(skill.name || `${projectName}-skill-${index + 1}`),
      description: skill.description || `Generated skill ${index + 1} for ${projectName}`,
      preferredAgent: agentNameSet.has(skill.preferredAgent) ? skill.preferredAgent : fallbackAgentName,
      systemPrompt: skill.systemPrompt || `You are using the ${skill.name || `${projectName}-skill-${index + 1}`} skill.`,
      tags: Array.isArray(skill.tags) ? skill.tags.map(tag => slugify(String(tag))).filter(Boolean) : ['harness', projectName],
    }));

  return {
    teamName,
    pattern,
    summary: raw.summary || fallback.summary,
    recommendedExecutor,
    agents,
    skills,
  };
}

function classifyHarnessPlannerFailure(error: unknown): HarnessGenerationError | null {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate_limit') ||
    normalized.includes('429')
  ) {
    return new HarnessGenerationError(
      normalized.includes('quota') ? 'quota_exceeded' : 'rate_limited',
      'Harness generation could not start because this Copilot account has no remaining chat usage. Try again later or switch to an account with available usage.',
    );
  }

  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden')
  ) {
    return new HarnessGenerationError(
      'authentication_failed',
      'Harness generation failed because Copilot authentication is not available in the current VS Code session. Reopen VS Code and confirm Copilot Chat is signed in.',
    );
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('bridge not responding') ||
    normalized.includes('bridge info not found') ||
    normalized.includes('econnrefused') ||
    normalized.includes('networkerror') ||
    normalized.includes('no response body from bridge')
  ) {
    return new HarnessGenerationError(
      'bridge_unavailable',
      'Harness generation failed because the local Copilot bridge is not reachable. Open VS Code and make sure the bridge extension is running.',
    );
  }

  return null;
}

async function generatePlanWithModel(
  provider: HarnessPlannerProvider,
  model: string,
  cwd: string,
): Promise<HarnessPlan> {
  const response = await provider.completeChat(
    [
      { role: 'system', content: 'You are a precise system designer. Return JSON only.' },
      { role: 'user', content: buildHarnessPlanningPrompt(cwd) },
    ],
    { model },
  );

  const jsonText = extractJsonObject(response);
  if (!jsonText) {
    throw new Error('Harness planner did not return valid JSON.');
  }
  return sanitizePlan(JSON.parse(jsonText) as HarnessPlan, cwd);
}

export function getHarnessTeamPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.omc', 'harness', 'team.json');
}

export function readHarnessTeam(cwd: string = process.cwd()): HarnessTeam | null {
  const filePath = getHarnessTeamPath(cwd);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as HarnessTeam;
  } catch {
    return null;
  }
}

export function deleteHarnessArtifacts(cwd: string = process.cwd()): void {
  const existing = readHarnessTeam(cwd);
  if (!existing) return;

  for (const agent of existing.agents) {
    removeIfOwned(agent.filePath, cwd);
  }
  for (const skill of existing.skills) {
    removeIfOwned(skill.filePath, cwd);
    removeIfOwned(path.join(path.dirname(skill.filePath), 'skill.json'), cwd);
    removeDirIfEmpty(path.dirname(skill.filePath), cwd);
  }

  removeIfOwned(getHarnessTeamPath(cwd), cwd);
  removeDirIfEmpty(path.dirname(getHarnessTeamPath(cwd)), cwd);
}

export async function generateHarness(
  cwd: string = process.cwd(),
  options?: { provider?: HarnessPlannerProvider; model?: string },
): Promise<HarnessTeam> {
  deleteHarnessArtifacts(cwd);
  const projectName = detectProjectName(cwd);
  const agentBaseDir = path.join(cwd, '.github', 'agents');
  const skillBaseDir = path.join(cwd, '.omc', 'skills');
  let plan = fallbackPlan(cwd);
  let generationMode: HarnessTeam['generationMode'] = 'deterministic-fallback';
  let generationWarning: string | undefined;
  if (options?.provider && options.model) {
    try {
      plan = await generatePlanWithModel(options.provider, options.model, cwd);
      generationMode = 'model-assisted';
    } catch (error) {
      const classified = classifyHarnessPlannerFailure(error);
      if (classified) throw classified;
      plan = fallbackPlan(cwd);
      generationMode = 'deterministic-fallback';
      generationWarning = 'Model-assisted harness planning failed, so a deterministic fallback harness was generated instead.';
    }
  }

  const agents: HarnessGeneratedAgent[] = plan.agents.map(agent => ({
    name: agent.name,
    role: agent.role,
    filePath: path.join(agentBaseDir, `${agent.name}.md`),
  }));
  const skills: HarnessGeneratedSkill[] = plan.skills.map(skill => ({
    name: skill.name,
    filePath: path.join(skillBaseDir, skill.name, 'SKILL.md'),
  }));

  for (let i = 0; i < plan.agents.length; i++) {
    const agent = plan.agents[i]!;
    writeIfChanged(
      path.join(agentBaseDir, `${agent.name}.md`),
      buildAgentMd(agent.name, agent.description, agent.systemPrompt, normalizeToolList(agent.tools)),
    );
  }

  for (const skill of plan.skills) {
    const skillDir = path.join(skillBaseDir, skill.name);
    ensureDir(skillDir);
    writeIfChanged(path.join(skillDir, 'SKILL.md'), buildSkillMd(skill.name, skill.systemPrompt));
    writeIfChanged(
      path.join(skillDir, 'skill.json'),
      buildSkillJson(skill.description, skill.preferredAgent, skill.tags ?? ['harness', projectName]),
    );
  }

  const team: HarnessTeam = {
    name: plan.teamName,
    pattern: plan.pattern,
    summary: plan.summary,
    recommendedExecutor: plan.recommendedExecutor,
    generatedAt: new Date().toISOString(),
    generationMode,
    modelUsed: options?.model,
    generationWarning,
    agents,
    skills,
  };

  writeIfChanged(getHarnessTeamPath(cwd), `${JSON.stringify(team, null, 2)}\n`);
  return team;
}
