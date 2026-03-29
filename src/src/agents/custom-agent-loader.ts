/**
 * Loads custom agents from multiple sources (in priority order):
 * 1. .github/agents/*.{md,agent.md}       — project-level (GitHub Copilot format)
 * 2. ~/Library/Application Support/Code/User/prompts/*.agent.md — VS Code user-level
 * 3. ~/.oh-my-copilot/agents/*.md          — global user agents
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseYaml } from 'yaml';
import type { McpServerConfig } from '../config/types';

export type AgentSource = 'project' | 'vscode' | 'global';

export interface CustomAgent {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  target?: 'vscode' | 'github-copilot';
  mcpServers?: Record<string, McpServerConfig>;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.oh-my-copilot', 'agents');

// VS Code user-level prompts — tries all known VS Code / Insiders / Codium variants
function getVSCodePromptsDirs(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    for (const appName of ['Code', 'Code - Insiders', 'VSCodium', 'Cursor']) {
      candidates.push(path.join(appSupport, appName, 'User', 'prompts'));
    }
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? home;
    for (const appName of ['Code', 'Code - Insiders', 'VSCodium', 'Cursor']) {
      candidates.push(path.join(appData, appName, 'User', 'prompts'));
    }
  } else {
    // Linux: XDG_CONFIG_HOME or ~/.config
    const configBase = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    for (const appName of ['Code', 'Code - Insiders', 'VSCodium', 'Cursor']) {
      candidates.push(path.join(configBase, appName, 'User', 'prompts'));
    }
  }

  return candidates.filter(d => fs.existsSync(d));
}

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  try {
    const parsed = parseYaml(match[1]);
    const meta = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    return { meta, body: match[2].trim() };
  } catch {
    return { meta: {}, body: match[2].trim() };
  }
}

function agentNameFromFile(file: string): string {
  // Strip known extensions: .agent.md, .prompt.md, .chatmode.md, .md
  return file
    .replace(/\.agent\.md$/, '')
    .replace(/\.prompt\.md$/, '')
    .replace(/\.chatmode\.md$/, '')
    .replace(/\.md$/, '');
}

function loadAgentsFromDir(dir: string, source: AgentSource, patterns: string[] = ['.md']): CustomAgent[] {
  if (!fs.existsSync(dir)) return [];

  const agents: CustomAgent[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f =>
      patterns.some(p => f.endsWith(p)) && !f.startsWith('.')
    );
  } catch {
    return [];
  }

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(content);
      const defaultName = agentNameFromFile(file);
      const name = String(meta.name ?? defaultName);
      const description = String(meta.description ?? `Custom agent: ${name}`);
      const target = meta.target === 'vscode' || meta.target === 'github-copilot'
        ? meta.target
        : undefined;

      const agentName2 = String(meta.name ?? agentNameFromFile(file));
      if (!body && !agentName2) continue; // Skip truly empty/invalid files
      // Use file name as fallback system prompt hint if body is empty
      const effectiveBody = body || `You are a helpful assistant named ${agentName2}.`;
      const rawTools = Array.isArray(meta.tools)
        ? meta.tools
        : typeof meta.tools === 'string'
          ? [meta.tools]
          : undefined;
      const rawMcpServers = meta['mcp-servers'];
      const mcpServers = rawMcpServers && typeof rawMcpServers === 'object'
        ? rawMcpServers as Record<string, McpServerConfig>
        : undefined;

      agents.push({
        name,
        description,
        model: meta.model ? String(meta.model) : undefined,
        tools: rawTools?.map(String),
        target,
        mcpServers,
        systemPrompt: effectiveBody,
        source,
        filePath,
      });
    } catch {
      // skip invalid files
    }
  }
  return agents;
}

export function loadCustomAgents(cwd: string = process.cwd()): CustomAgent[] {
  // 1a. .github/agents/ (older GitHub Copilot format)
  const projectAgentsDir = path.join(cwd, '.github', 'agents');
  const projectAgents1 = loadAgentsFromDir(projectAgentsDir, 'project', ['.md', '.agent.md']);

  // 1b. .github/copilot/ (VS Code 1.99+ format)
  const copilotDir = path.join(cwd, '.github', 'copilot');
  const projectAgents2 = loadAgentsFromDir(copilotDir, 'project', ['.agent.md', '.chatmode.md', '.md']);

  const projectAgents = [...projectAgents1, ...projectAgents2];

  // 2. VS Code user-level agents — all matching editor variants
  const vscodeDirs = getVSCodePromptsDirs();
  const vscodeAgents = vscodeDirs.flatMap(dir =>
    loadAgentsFromDir(dir, 'vscode', ['.agent.md', '.prompt.md', '.md'])
  );

  // 3. Oh-my-copilot global agents (~/.oh-my-copilot/agents/)
  const globalAgents = loadAgentsFromDir(GLOBAL_AGENTS_DIR, 'global', ['.md']);

  // Deduplicate: project > vscode > global (first seen wins)
  const seen = new Set<string>();
  const result: CustomAgent[] = [];
  for (const agent of [...projectAgents, ...vscodeAgents, ...globalAgents]) {
    if (agent.target && agent.target !== 'vscode') continue;
    if (!seen.has(agent.name)) {
      seen.add(agent.name);
      result.push(agent);
    }
  }

  return result;
}

export function ensureGlobalAgentsDir(): void {
  if (!fs.existsSync(GLOBAL_AGENTS_DIR)) {
    fs.mkdirSync(GLOBAL_AGENTS_DIR, { recursive: true });
  }
}

export const GLOBAL_AGENTS_DIR_PATH = GLOBAL_AGENTS_DIR;
