import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseJsonc, ParseError } from 'jsonc-parser';
import type { OhMyCopilotConfig } from './types';

const CONFIG_FILENAMES = ['oh-my-copilot.jsonc', 'oh-my-copilot.json', '.oh-my-copilot.json'];
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.oh-my-copilot');

function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Check global config
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(GLOBAL_CONFIG_DIR, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJsonc(filePath: string): OhMyCopilotConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const errors: ParseError[] = [];
  const parsed = parseJsonc(raw, errors);
  if (errors.length > 0) {
    console.warn(`[config] JSONC parse warnings in ${filePath}`);
  }
  return parsed as OhMyCopilotConfig;
}

export function loadConfig(cwd: string = process.cwd()): OhMyCopilotConfig {
  const configPath = findConfigFile(cwd);
  if (!configPath) return {};

  try {
    return readJsonc(configPath);
  } catch (err) {
    console.warn(`[config] Failed to load config at ${configPath}: ${err}`);
    return {};
  }
}

export function writeConfig(config: OhMyCopilotConfig, targetDir: string = process.cwd()): string {
  const targetPath = path.join(targetDir, 'oh-my-copilot.jsonc');
  const content = JSON.stringify(config, null, 2);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, content + '\n', 'utf-8');
  return targetPath;
}

export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}

export function ensureGlobalConfigDir(): void {
  if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
}
