/**
 * Reads MCP server configuration from VS Code/Cursor-style mcp.json files.
 * Discovery order is low-priority to high-priority so later files override earlier ones:
 *   1. Editor user-level mcp.json files (VS Code, Cursor, etc.)
 *   2. ~/.oh-my-copilot/mcp.json
 *   3. Workspace-level files (.vscode/mcp.json, .cursor/mcp.json, .mcp.json)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseJsonc } from 'jsonc-parser';
import type { McpServerConfig, OhMyCopilotConfig } from '../config/types';

export interface McpServerEntry extends McpServerConfig {
  sourcePath?: string;
  sourceScope?: 'editor-user' | 'global' | 'workspace';
}

export interface McpConfigSource {
  path: string;
  scope: 'editor-user' | 'global' | 'workspace';
  exists: boolean;
  serverCount: number;
}

export interface McpConfig {
  servers: Record<string, McpServerEntry>;
  sources: McpConfigSource[];
}

const GLOBAL_MCP_PATH = path.join(os.homedir(), '.oh-my-copilot', 'mcp.json');

function getEditorUserMcpPaths(): string[] {
  const home = os.homedir();
  const names = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'];
  if (process.platform === 'darwin') {
    const root = path.join(home, 'Library', 'Application Support');
    return names.map(name => path.join(root, name, 'User', 'mcp.json'));
  }
  if (process.platform === 'win32') {
    const root = process.env.APPDATA ?? home;
    return names.map(name => path.join(root, name, 'User', 'mcp.json'));
  }
  const root = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return names.map(name => path.join(root, name, 'User', 'mcp.json'));
}

function getWorkspaceMcpPaths(cwd: string): string[] {
  return [
    path.join(cwd, '.vscode', 'mcp.json'),
    path.join(cwd, '.cursor', 'mcp.json'),
    path.join(cwd, '.mcp.json'),
  ];
}

function normalizeServerEntry(
  entry: unknown,
  sourcePath: string,
  scope: McpConfigSource['scope'],
): McpServerEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry as Record<string, unknown>;
  const type = raw.type === 'http' ? 'http' : 'stdio';

  const normalized: McpServerEntry = {
    type,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    env: raw.env && typeof raw.env === 'object'
      ? Object.fromEntries(Object.entries(raw.env).map(([key, value]) => [key, String(value)]))
      : undefined,
    headers: raw.headers && typeof raw.headers === 'object'
      ? Object.fromEntries(Object.entries(raw.headers).map(([key, value]) => [key, String(value)]))
      : undefined,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    enabled: raw.enabled === false ? false : true,
    autoStart: raw.autoStart === false ? false : true,
    sourcePath,
    sourceScope: scope,
  };

  if (type === 'stdio' && !normalized.command) return null;
  if (type === 'http' && !normalized.url) return null;
  return normalized;
}

function readMcpFile(filePath: string, scope: McpConfigSource['scope']): McpConfig | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parseJsonc(raw) as Record<string, unknown>;
    let serverMap: Record<string, unknown> = {};

    if (parsed && typeof parsed === 'object') {
      if ('servers' in parsed && parsed.servers && typeof parsed.servers === 'object') {
        serverMap = parsed.servers as Record<string, unknown>;
      } else {
        const firstVal = Object.values(parsed)[0];
        if (firstVal && typeof firstVal === 'object' && ('command' in firstVal || 'url' in firstVal)) {
          serverMap = parsed;
        }
      }
    }

    const servers = Object.fromEntries(
      Object.entries(serverMap)
        .map(([name, value]) => [name, normalizeServerEntry(value, filePath, scope)])
        .filter((entry): entry is [string, McpServerEntry] => Boolean(entry[1])),
    );

    return {
      servers,
      sources: [{
        path: filePath,
        scope,
        exists: true,
        serverCount: Object.keys(servers).length,
      }],
    };
  } catch {
    return {
      servers: {},
      sources: [{
        path: filePath,
        scope,
        exists: true,
        serverCount: 0,
      }],
    };
  }
}

function dedupePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(filePath => path.resolve(filePath))));
}

export function getDiscoveredMcpConfigPaths(
  cwd: string = process.cwd(),
  config?: OhMyCopilotConfig,
): McpConfigSource[] {
  const configuredPaths = config?.mcp?.configPaths?.map(filePath =>
    path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath),
  ) ?? [];
  const orderedPaths: Array<{ path: string; scope: McpConfigSource['scope'] }> = [
    ...getEditorUserMcpPaths().map(filePath => ({ path: filePath, scope: 'editor-user' as const })),
    { path: GLOBAL_MCP_PATH, scope: 'global' as const },
    ...getWorkspaceMcpPaths(cwd).map(filePath => ({ path: filePath, scope: 'workspace' as const })),
    ...configuredPaths.map(filePath => ({ path: filePath, scope: 'workspace' as const })),
  ];

  return dedupePaths(orderedPaths.map(entry => entry.path)).map(filePath => {
    const entry = orderedPaths.find(candidate => path.resolve(candidate.path) === filePath);
    return {
      path: filePath,
      scope: entry?.scope ?? 'workspace',
      exists: fs.existsSync(filePath),
      serverCount: 0,
    };
  });
}

export function loadMcpConfig(
  cwd: string = process.cwd(),
  config?: OhMyCopilotConfig,
): McpConfig {
  const discovered = getDiscoveredMcpConfigPaths(cwd, config);
  const merged: Record<string, McpServerEntry> = {};
  const sources: McpConfigSource[] = [];

  for (const source of discovered) {
    const loaded = readMcpFile(source.path, source.scope);
    if (loaded) {
      Object.assign(merged, loaded.servers);
      sources.push(...loaded.sources);
    } else {
      sources.push(source);
    }
  }

  return { servers: merged, sources };
}

export function getAutoConnectMcpServers(
  cwd: string = process.cwd(),
  config?: OhMyCopilotConfig,
): Record<string, McpServerEntry> {
  if (config?.mcp?.enabled === false) return {};
  const loaded = loadMcpConfig(cwd, config);
  return Object.fromEntries(
    Object.entries(loaded.servers).filter(([, server]) =>
      server.enabled !== false && (config?.mcp?.autoConnectDiscovered !== false ? server.autoStart !== false : false),
    ),
  );
}

export function hasMcpConfig(cwd: string = process.cwd(), config?: OhMyCopilotConfig): boolean {
  return getDiscoveredMcpConfigPaths(cwd, config).some(source => source.exists);
}
