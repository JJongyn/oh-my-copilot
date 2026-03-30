import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUNDLED_SKILLS } from './bundled-skills';
import type { SkillDefinition, SkillMetadata, SkillSource, SkillStateFile } from './types';

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.oh-my-copilot', 'skills');
const GLOBAL_SKILLS_STATE = path.join(os.homedir(), '.oh-my-copilot', 'skills-state.json');

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

function parseSkillDir(dir: string, source: SkillSource): SkillDefinition | null {
  const skillPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;

  const rawPrompt = fs.readFileSync(skillPath, 'utf8').trim();
  if (!rawPrompt) return null;

  const metaPath = path.join(dir, 'skill.json');
  const meta = readJson<SkillMetadata & { name?: string }>(metaPath) ?? {};
  const fallbackName = path.basename(dir);
  const name = normalizeName(meta.name ?? fallbackName);

  return {
    name,
    source,
    filePath: skillPath,
    description: meta.description ?? `Skill: ${name}`,
    preferredAgent: meta.preferredAgent,
    recommendedMcpServers: meta.recommendedMcpServers,
    recommendedTools: meta.recommendedTools,
    tags: meta.tags,
    systemPrompt: rawPrompt,
  };
}

function loadSkillsFromParent(rootDir: string, source: SkillSource): SkillDefinition[] {
  if (!fs.existsSync(rootDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => parseSkillDir(path.join(rootDir, entry.name), source))
    .filter((skill): skill is SkillDefinition => Boolean(skill));
}

export function getProjectSkillsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.omc', 'skills');
}

export function getProjectLocalSkillsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.omc', 'skills.local');
}

export function getGlobalSkillsDir(): string {
  return GLOBAL_SKILLS_DIR;
}

export function ensureSkillDirectories(cwd: string = process.cwd()): void {
  const requiredDirs = [getProjectSkillsDir(cwd), getProjectLocalSkillsDir(cwd)];
  for (const dir of requiredDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  } catch {
    // Global skills are optional; project init/install should still succeed.
  }
}

export function loadSkills(cwd: string = process.cwd()): SkillDefinition[] {
  const project = loadSkillsFromParent(getProjectSkillsDir(cwd), 'project');
  const projectLocal = loadSkillsFromParent(getProjectLocalSkillsDir(cwd), 'project-local');
  const global = loadSkillsFromParent(GLOBAL_SKILLS_DIR, 'global');
  const bundled = BUNDLED_SKILLS;

  const seen = new Set<string>();
  const result: SkillDefinition[] = [];
  for (const skill of [...projectLocal, ...project, ...global, ...bundled]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      result.push(skill);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function readState(filePath: string): SkillStateFile {
  return readJson<SkillStateFile>(filePath) ?? {};
}

function writeState(filePath: string, state: SkillStateFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function uniqueNames(names: string[]): string[] {
  return Array.from(new Set(names.map(normalizeName).filter(Boolean))).sort();
}

export function getProjectSkillsStatePath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.omc', 'skills-state.json');
}

export function readProjectPinnedSkills(cwd: string = process.cwd()): string[] {
  return uniqueNames(readState(getProjectSkillsStatePath(cwd)).pinned ?? []);
}

export function readGlobalPinnedSkills(): string[] {
  return uniqueNames(readState(GLOBAL_SKILLS_STATE).pinned ?? []);
}

export function writeProjectPinnedSkills(names: string[], cwd: string = process.cwd()): void {
  writeState(getProjectSkillsStatePath(cwd), { pinned: uniqueNames(names) });
}

export function writeGlobalPinnedSkills(names: string[]): void {
  writeState(GLOBAL_SKILLS_STATE, { pinned: uniqueNames(names) });
}

export function getDefaultActiveSkills(cwd: string = process.cwd()): string[] {
  return uniqueNames([...readGlobalPinnedSkills(), ...readProjectPinnedSkills(cwd)]);
}

export function resolveActiveSkills(activeNames: string[], cwd: string = process.cwd()): SkillDefinition[] {
  const names = new Set(activeNames.map(normalizeName));
  return loadSkills(cwd).filter(skill => names.has(skill.name));
}

export function summarizeSkill(skill: SkillDefinition): string {
  const parts = [skill.description ?? ''];
  if (skill.preferredAgent) parts.push(`preferred agent: ${skill.preferredAgent}`);
  if (skill.recommendedMcpServers?.length) {
    parts.push(`MCP: ${skill.recommendedMcpServers.join(', ')}`);
  }
  return parts.filter(Boolean).join(' · ');
}
