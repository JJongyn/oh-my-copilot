import * as fs from 'fs';
import * as path from 'path';
import { writeConfig } from '../../config/config-manager';
import { readBridgeInfo, CopilotBridgeProvider } from '../../provider/copilot-bridge';
import { analyzeProject, formatProjectAnalysisMarkdown } from '../../init/project-analyzer';
import type { OhMyCopilotConfig } from '../../config/types';
import { ensureSkillDirectories } from '../../skills/skill-loader';

function chooseDefaultModel(models: string[]): string {
  for (const preferred of ['gpt-5-mini', 'gpt-4.1', 'gpt-4o']) {
    if (models.some(model => model.includes(preferred))) return preferred;
  }
  return models[0] ?? 'gpt-5-mini';
}

function chooseSuggestedAgent(sourceFileCount: number): string {
  if (sourceFileCount >= 120) return 'hephaestus';
  if (sourceFileCount >= 40) return 'sisyphus';
  return 'prometheus';
}

export async function runInit(options: { dir?: string; force?: boolean } = {}): Promise<void> {
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const configPath = path.join(targetDir, 'oh-my-copilot.jsonc');
  const contextDir = path.join(targetDir, '.omc');
  const contextPath = path.join(contextDir, 'project-context.md');

  console.log('\n\x1b[1moh-my-copilot init\x1b[0m\n');
  console.log('Analyzing current project for Copilot-bridge-first setup...\n');

  const analysis = analyzeProject(targetDir);
  const bridgeInfo = readBridgeInfo();

  let availableModels: string[] = [];
  if (bridgeInfo) {
    const provider = new CopilotBridgeProvider(bridgeInfo);
    const healthy = await provider.checkHealth().catch(() => false);
    if (healthy) {
      try {
        const models = await provider.listModels();
        availableModels = models.map(model => model.family || model.id);
        console.log(`\x1b[32m✓ Bridge connected\x1b[0m`);
        if (availableModels.length > 0) {
          console.log(`\x1b[32m✓ Copilot models: ${availableModels.join(', ')}\x1b[0m`);
        }
      } catch {
        console.log('\x1b[33m⚠ Bridge reachable but model listing failed\x1b[0m');
      }
    } else {
      console.log('\x1b[33m⚠ Bridge found but not responding. Open VS Code/Cursor with the bridge active.\x1b[0m');
    }
  } else {
    console.log('\x1b[33m⚠ Bridge info not found. Init will continue with local project analysis only.\x1b[0m');
  }

  const defaultModel = chooseDefaultModel(availableModels);
  const suggestedAgent = chooseSuggestedAgent(analysis.sourceFileCount);

  const config: OhMyCopilotConfig = {
    model: defaultModel,
    agents: {
      sisyphus: { model: defaultModel, temperature: 0.1 },
      hephaestus: { model: defaultModel, temperature: 0.3 },
      prometheus: { model: defaultModel, temperature: 0.1 },
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

  if (fs.existsSync(configPath) && !options.force) {
    console.log(`\x1b[33m⚠ Config already exists: ${configPath}\x1b[0m`);
    console.log('  Re-run with `--force` to overwrite it.\n');
  } else {
    writeConfig(config, targetDir);
    console.log(`\x1b[32m✓ Wrote config: ${configPath}\x1b[0m`);
  }

  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(contextPath, formatProjectAnalysisMarkdown(analysis, targetDir), 'utf8');
  console.log(`\x1b[32m✓ Wrote project context: ${contextPath}\x1b[0m`);
  ensureSkillDirectories(targetDir);
  console.log(`\x1b[32m✓ Ensured skill directories: ${path.join(targetDir, '.omc', 'skills')} and skills.local\x1b[0m`);

  console.log();
  console.log('Analysis summary:');
  console.log(`  • Type: ${analysis.likelyAppType}`);
  console.log(`  • Languages: ${analysis.languages.join(', ') || 'Unknown'}`);
  console.log(`  • Source files: ${analysis.sourceFileCount}`);
  console.log(`  • Tests detected: ${analysis.hasTests ? 'yes' : 'no'}`);
  console.log(`  • Custom Copilot agents: ${analysis.hasCustomAgents ? 'yes' : 'no'}`);
  console.log(`  • MCP config: ${analysis.hasMcpConfig ? 'yes' : 'no'}`);
  console.log();
  console.log('Suggested defaults:');
  console.log(`  • Model: ${defaultModel}`);
  console.log(`  • Primary agent: ${suggestedAgent}`);
  console.log();
  console.log('Next steps:');
  console.log('  • Review `.omc/project-context.md` and keep it current');
  console.log('  • Add project-specific skills under `.omc/skills/<name>/SKILL.md`');
  console.log('  • Edit `oh-my-copilot.jsonc` if you want different default agents/models');
  console.log('  • Run `omc chat` or `omc run "<task>"` inside this repository');
  console.log();
}
