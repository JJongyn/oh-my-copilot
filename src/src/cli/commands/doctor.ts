import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readBridgeInfo, CopilotBridgeProvider } from '../../provider/copilot-bridge';
import { loadConfig } from '../../config/config-manager';
import { loadMcpConfig } from '../../mcp/mcp-config';

const BRIDGE_INFO_PATH = path.join(os.homedir(), '.oh-my-copilot', 'bridge.json');

type CheckStatus = 'ok' | 'warn' | 'error';

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

function icon(status: CheckStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '⚠';
  return '✗';
}

function color(status: CheckStatus, text: string): string {
  const codes = { ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
  return `${codes[status]}${text}\x1b[0m`;
}

async function checkBridgeFile(): Promise<CheckResult> {
  const info = readBridgeInfo();
  if (!info) {
    return {
      name: 'Bridge config file',
      status: 'error',
      message: `Not found at ${BRIDGE_INFO_PATH}`,
      detail: 'Open VSCode with oh-my-copilot-bridge extension installed. It will auto-create this file.',
    };
  }
  return {
    name: 'Bridge config file',
    status: 'ok',
    message: `Found (port: ${info.port}, models: ${info.models.join(', ') || 'unknown'})`,
  };
}

async function checkBridgeConnection(): Promise<CheckResult> {
  const info = readBridgeInfo();
  if (!info) {
    return { name: 'Bridge connection', status: 'error', message: 'No bridge config — skipping' };
  }
  const provider = new CopilotBridgeProvider(info);
  const healthy = await provider.checkHealth();
  if (!healthy) {
    return {
      name: 'Bridge connection',
      status: 'error',
      message: `Cannot connect to bridge at 127.0.0.1:${info.port}`,
      detail: 'VSCode may be closed or bridge extension may have stopped. Reopen VSCode.',
    };
  }
  return { name: 'Bridge connection', status: 'ok', message: `Connected to 127.0.0.1:${info.port}` };
}

async function checkModels(): Promise<CheckResult> {
  const info = readBridgeInfo();
  if (!info) {
    return { name: 'Copilot models', status: 'error', message: 'No bridge config — skipping' };
  }
  const provider = new CopilotBridgeProvider(info);
  try {
    const models = await provider.listModels();
    if (models.length === 0) {
      return {
        name: 'Copilot models',
        status: 'warn',
        message: 'No models available',
        detail: 'Ensure GitHub Copilot subscription is active and signed in.',
      };
    }
    return {
      name: 'Copilot models',
      status: 'ok',
      message: `${models.length} model(s): ${models.map(m => m.family || m.id).join(', ')}`,
    };
  } catch (err) {
    return { name: 'Copilot models', status: 'error', message: `Failed: ${err}` };
  }
}

async function checkEditorTools(): Promise<CheckResult> {
  const info = readBridgeInfo();
  if (!info) {
    return { name: 'Copilot editor tools', status: 'warn', message: 'No bridge config — skipping' };
  }
  const provider = new CopilotBridgeProvider(info);
  try {
    const tools = await provider.listEditorTools();
    return {
      name: 'Copilot editor tools',
      status: 'ok',
      message: `${tools.length} tool(s) visible through vscode.lm`,
      detail: tools.length > 0 ? tools.slice(0, 8).map(tool => tool.name).join(', ') : 'No editor tools are currently visible.',
    };
  } catch (err) {
    return { name: 'Copilot editor tools', status: 'warn', message: `Unavailable: ${err}` };
  }
}

function checkConfig(): CheckResult {
  const config = loadConfig();
  const hasConfig = Object.keys(config).length > 0;
  return {
    name: 'oh-my-copilot config',
    status: hasConfig ? 'ok' : 'warn',
    message: hasConfig ? 'Config loaded' : 'No oh-my-copilot.jsonc found (using defaults)',
    detail: hasConfig ? undefined : 'Run `oh-my-copilot install` to create a config file.',
  };
}

function checkMcpConfigDiscovery(): CheckResult {
  const config = loadConfig();
  const discovered = loadMcpConfig(process.cwd(), config);
  const sourceCount = discovered.sources.filter(source => source.exists).length;
  const serverCount = Object.keys(discovered.servers).length;
  if (sourceCount === 0) {
    return {
      name: 'MCP configuration',
      status: 'warn',
      message: 'No MCP config files found',
      detail: 'Checked workspace, editor user config, and ~/.oh-my-copilot/mcp.json',
    };
  }
  return {
    name: 'MCP configuration',
    status: 'ok',
    message: `${serverCount} server(s) discovered from ${sourceCount} config file(s)`,
    detail: discovered.sources
      .filter(source => source.exists)
      .map(source => source.path)
      .join(', '),
  };
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 18) {
    return {
      name: 'Node.js version',
      status: 'error',
      message: `Node ${version} — requires >= 18`,
    };
  }
  return { name: 'Node.js version', status: 'ok', message: version };
}

export async function runDoctor(options: { verbose?: boolean } = {}): Promise<void> {
  console.log('\n\x1b[1moh-my-copilot doctor\x1b[0m\n');

  const checks: CheckResult[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkConfig());
  checks.push(await checkBridgeFile());
  checks.push(await checkBridgeConnection());
  checks.push(await checkModels());
  checks.push(await checkEditorTools());
  checks.push(checkMcpConfigDiscovery());

  let hasErrors = false;
  let hasWarnings = false;

  for (const check of checks) {
    if (check.status === 'error') hasErrors = true;
    if (check.status === 'warn') hasWarnings = true;

    const statusIcon = icon(check.status);
    const statusText = color(check.status, `[${statusIcon}]`);
    console.log(`  ${statusText} ${check.name}: ${check.message}`);

    if (options.verbose && check.detail) {
      console.log(`       ${'\x1b[90m'}${check.detail}\x1b[0m`);
    } else if (check.status !== 'ok' && check.detail) {
      console.log(`       ${'\x1b[90m'}${check.detail}\x1b[0m`);
    }
  }

  console.log();
  if (hasErrors) {
    console.log(color('error', '  Some checks failed. Fix the issues above to use oh-my-copilot.'));
  } else if (hasWarnings) {
    console.log(color('warn', '  Some warnings. oh-my-copilot should work but review the warnings.'));
  } else {
    console.log(color('ok', '  All checks passed! oh-my-copilot is ready.'));
  }
  console.log();
}
