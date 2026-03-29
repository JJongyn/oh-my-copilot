import React from 'react';
import { render } from 'ink';
import { spawnSync } from 'child_process';
import { App } from './App';
import { CopilotBridgeProvider, readBridgeInfo } from '../provider/copilot-bridge';
import { loadConfig } from '../config/config-manager';
import { getAutoConnectMcpServers } from '../mcp/mcp-config';
import { McpClientManager } from '../mcp/mcp-client';
import { loadCustomAgents } from '../agents/custom-agent-loader';
import { SessionManager } from '../session/session-manager';
import { registerShellHandler } from './shell-bridge';
import type { McpServerConfig } from '../config/types';
import type { Session } from '../session/session-manager';
import type { BridgeToolInfo } from '../provider/types';

export interface LaunchOptions {
  agent?: string;
  model?: string;
  resume?: string | Session;
}

export async function launchTUI(options: LaunchOptions = {}): Promise<void> {
  const config = loadConfig();
  const bridgeInfo = readBridgeInfo();

  if (!bridgeInfo) {
    console.error('\x1b[31mx Bridge not found.\x1b[0m');
    console.error('  Open VS Code with the oh-my-copilot-bridge extension installed.');
    console.error('  The extension auto-creates ~/.oh-my-copilot/bridge.json on startup.');
    console.error('\n  Run: oh-my-copilot doctor\n');
    process.exit(1);
  }

  const provider = new CopilotBridgeProvider(bridgeInfo);

  const healthy = await provider.checkHealth().catch(() => false);
  if (!healthy) {
    console.error(`\x1b[31mx Bridge not responding at 127.0.0.1:${bridgeInfo.port}\x1b[0m`);
    console.error('  Ensure VS Code is open and the bridge extension is active.');
    console.error('  Status bar should show: $(plug) Copilot Bridge :PORT\n');
    process.exit(1);
  }

  // Prefer gpt-5-mini if available, otherwise first bridge model
  const preferredDefault = 'gpt-5-mini';
  const defaultModel = bridgeInfo.models.some(m => m.includes(preferredDefault))
    ? preferredDefault
    : bridgeInfo.models[0] ?? preferredDefault;
  const model = options.model ?? config.model ?? defaultModel;

  // Resolve session — support both Session object and session ID string
  let initialSession: Session | undefined;
  if (options.resume) {
    if (typeof options.resume === 'string') {
      const sm = new SessionManager();
      const loaded = sm.load(options.resume);
      if (loaded) {
        initialSession = loaded;
      } else {
        // Try partial match (first 8 chars)
        const sessions = sm.listSessions();
        const match = sessions.find(s => s.id.startsWith(options.resume as string));
        if (match) {
          initialSession = sm.load(match.id) ?? undefined;
        }
        if (!initialSession) {
          console.error(`\x1b[31mx Session not found: ${options.resume}\x1b[0m`);
          console.error('  Run: omc sessions   to see available sessions\n');
          process.exit(1);
        }
      }
    } else {
      initialSession = options.resume;
    }
  }

  // MCP setup
  const mcpClient = new McpClientManager();
  const customAgentMcpServers = loadCustomAgents(process.cwd()).reduce<Record<string, McpServerConfig>>((acc, agent) => {
    return {
      ...acc,
      ...Object.fromEntries(
        Object.entries(agent.mcpServers ?? {}).filter(([, server]) =>
          server.enabled !== false && server.autoStart !== false,
        ),
      ),
    };
  }, {});
  const discoveredMcpServers = getAutoConnectMcpServers(process.cwd(), config);
  const allMcpServers: Record<string, McpServerConfig> = {
    ...Object.fromEntries(
      Object.entries(config.mcpServers ?? {}).filter(([, server]) =>
        server.enabled !== false && server.autoStart !== false,
      ),
    ),
    ...discoveredMcpServers,
    ...customAgentMcpServers,
  };
  for (const disabled of config.disabledMcps ?? []) {
    delete allMcpServers[disabled];
  }
  if (Object.keys(allMcpServers).length > 0) {
    mcpClient.connectAll(allMcpServers).catch(() => {});
  }

  let bridgeTools: BridgeToolInfo[] = [];
  if (config.mcp?.includeEditorTools !== false) {
    bridgeTools = await provider.listEditorTools().catch(() => []);
  }

  // Determine initial agent — from resume session, CLI option, or default
  const agent = initialSession?.meta.agent ?? options.agent ?? 'sisyphus';

  // Main render loop — re-enters after each shell session
  while (true) {
    let shellRequested = false;

    const { waitUntilExit, unmount } = render(
      <App
        provider={provider}
        initialAgent={agent}
        initialModel={model}
        initialSession={initialSession}
        mcpClient={mcpClient}
        bridgeTools={bridgeTools}
      />,
      { exitOnCtrlC: true },
    );

    registerShellHandler(() => {
      shellRequested = true;
      unmount();
      process.stdin.resume();
    });

    await waitUntilExit();

    if (!shellRequested) break;

    process.stdout.write('\r\n');
    spawnSync(process.env.SHELL ?? '/bin/zsh', [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        COLUMNS: String(process.stdout.columns),
        LINES: String(process.stdout.rows),
      },
    });
    process.stdout.write('\r\n');
    // Clear initialSession after first render so re-render starts fresh
    initialSession = undefined;
  }

  await mcpClient.disconnectAll();
}
