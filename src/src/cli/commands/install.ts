import * as path from 'path';
import { writeConfig } from '../../config/config-manager';
import { readBridgeInfo, CopilotBridgeProvider } from '../../provider/copilot-bridge';
import type { OhMyCopilotConfig } from '../../config/types';
import { ensureSkillDirectories } from '../../skills/skill-loader';

export async function runInstall(options: { yes?: boolean; dir?: string } = {}): Promise<void> {
  const targetDir = options.dir ?? process.cwd();

  console.log('\n\x1b[1moh-my-copilot install\x1b[0m\n');
  console.log('Setting up oh-my-copilot for this project...\n');

  // Check bridge
  const bridgeInfo = readBridgeInfo();
  if (!bridgeInfo) {
    console.warn('\x1b[33m⚠ Bridge not found.\x1b[0m');
    console.log('  To use oh-my-copilot, you need the VSCode extension installed:');
    console.log('  1. Open VS Code');
    console.log('  2. Install the "oh-my-copilot-bridge" extension');
    console.log('  3. The bridge will auto-start and create ~/.oh-my-copilot/bridge.json\n');
  } else {
    const provider = new CopilotBridgeProvider(bridgeInfo);
    const healthy = await provider.checkHealth().catch(() => false);
    if (healthy) {
      console.log('\x1b[32m✓ Bridge connected\x1b[0m');

      try {
        const models = await provider.listModels();
        if (models.length > 0) {
          console.log(`\x1b[32m✓ Available models: ${models.map(m => m.family || m.id).join(', ')}\x1b[0m`);
        }
      } catch {
        // ignore model listing failure
      }
    } else {
      console.warn('\x1b[33m⚠ Bridge found but not responding — ensure VS Code is open\x1b[0m');
    }
  }

  console.log();

  // Write config file
  const config: OhMyCopilotConfig = {
    model: 'gpt-5-mini',
    agents: {
      sisyphus: {
        model: 'gpt-5-mini',
        temperature: 0.3,
      },
    },
    disabledAgents: [],
    mcpServers: {},
    disabledMcps: [],
    mcp: {
      enabled: true,
      includeEditorTools: true,
      autoConnectDiscovered: true,
      configPaths: [],
    },
    session: {
      maxHistory: 100,
      maxContextChars: 24000,
      preserveRecentMessages: 8,
    },
    hooks: {
      enabled: true,
      disabled: [],
    },
    permissions: {
      runTerminal: 'ask',
    },
  };

  const configPath = writeConfig(config, targetDir);
  console.log(`\x1b[32m✓ Created config: ${configPath}\x1b[0m`);
  ensureSkillDirectories(targetDir);
  console.log(`\x1b[32m✓ Ensured skill directories under .omc/\x1b[0m`);
  console.log();
  console.log('Next steps:');
  console.log('  • oh-my-copilot chat         — start interactive chat');
  console.log('  • oh-my-copilot run <task>   — run a single task');
  console.log('  • oh-my-copilot doctor       — check system health');
  console.log('  • oh-my-copilot models       — list available models');
  console.log();
  console.log('Edit oh-my-copilot.jsonc to customize agents, models, and MCP servers.');
  console.log();
}
