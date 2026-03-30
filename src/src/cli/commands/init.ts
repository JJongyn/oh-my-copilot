import * as fs from 'fs';
import * as path from 'path';
import { writeConfig } from '../../config/config-manager';
import { readBridgeInfo, CopilotBridgeProvider } from '../../provider/copilot-bridge';
import { analyzeProject, formatProjectAnalysisMarkdown } from '../../init/project-analyzer';
import type { ProjectAnalysis } from '../../init/project-analyzer';
import { generateHierarchicalAgents, type GeneratedAgentsFile } from '../../init/agents-context';
import type { OhMyCopilotConfig } from '../../config/types';
import { ensureSkillDirectories } from '../../skills/skill-loader';

interface InitReporter {
  log: (message?: string) => void;
}

export interface InitResult {
  targetDir: string;
  configPath: string;
  contextPath: string;
  configAlreadyExists: boolean;
  availableModels: string[];
  defaultModel: string;
  suggestedAgent: string;
  analysis: ProjectAnalysis;
  agentsFiles: GeneratedAgentsFile[];
}

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

export async function runInit(
  options: { dir?: string; force?: boolean; reporter?: InitReporter } = {},
): Promise<InitResult> {
  const reporter = options.reporter ?? { log: (message?: string) => console.log(message ?? '') };
  const log = (message?: string) => reporter.log(message);
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const configPath = path.join(targetDir, 'oh-my-copilot.jsonc');
  const contextDir = path.join(targetDir, '.omc');
  const contextPath = path.join(contextDir, 'project-context.md');

  log('\n\x1b[1moh-my-copilot init\x1b[0m\n');
  log(`Analyzing current project for Copilot-bridge-first setup...\n`);

  const analysis = analyzeProject(targetDir);
  const bridgeInfo = readBridgeInfo();

  let availableModels: string[] = [];
  if (bridgeInfo) {
    const provider = new CopilotBridgeProvider(bridgeInfo);
    const healthy = await provider.checkHealth().catch(() => false);
    if (healthy) {
      try {
        const models = await provider.listModels();
        availableModels = Array.from(new Set(models.map(model => model.family || model.id)));
        log(`\x1b[32m✓ Bridge connected\x1b[0m`);
        if (availableModels.length > 0) {
          log(`\x1b[32m✓ Copilot models: ${availableModels.join(', ')}\x1b[0m`);
        }
      } catch {
        log('\x1b[33m⚠ Bridge reachable but model listing failed\x1b[0m');
      }
    } else {
      log('\x1b[33m⚠ Bridge found but not responding. Open VS Code/Cursor with the bridge active.\x1b[0m');
    }
  } else {
    log('\x1b[33m⚠ Bridge info not found. Init will continue with local project analysis only.\x1b[0m');
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

  const configAlreadyExists = fs.existsSync(configPath) && !options.force;
  if (configAlreadyExists) {
    log(`\x1b[33m⚠ Config already exists: ${configPath}\x1b[0m`);
    log('  Re-run with `--force` to overwrite it.\n');
  } else {
    writeConfig(config, targetDir);
    log(`\x1b[32m✓ Wrote config: ${configPath}\x1b[0m`);
  }

  const agentsFiles = generateHierarchicalAgents(targetDir, analysis, options.force === true);
  const createdOrUpdatedAgents = agentsFiles.filter(file => file.status === 'created' || file.status === 'updated');
  const keptAgents = agentsFiles.filter(file => file.status === 'kept');
  if (createdOrUpdatedAgents.length > 0) {
    log(`\x1b[32m✓ Scaffolded AGENTS context: ${createdOrUpdatedAgents.length} file(s)\x1b[0m`);
    for (const file of createdOrUpdatedAgents) {
      log(`  • ${path.relative(targetDir, file.path) || 'AGENTS.md'} (${file.status})`);
    }
  }
  if (keptAgents.length > 0) {
    log(`\x1b[33m⚠ Preserved existing AGENTS files: ${keptAgents.length}\x1b[0m`);
  }

  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(contextPath, formatProjectAnalysisMarkdown(analysis, targetDir), 'utf8');
  log(`\x1b[32m✓ Wrote project snapshot: ${contextPath}\x1b[0m`);
  try {
    ensureSkillDirectories(targetDir);
    log(`\x1b[32m✓ Ensured skill directories: ${path.join(targetDir, '.omc', 'skills')} and skills.local\x1b[0m`);
  } catch (err) {
    log(`\x1b[33m⚠ Skill directory setup partially failed: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  }

  log();
  log('Analysis summary:');
  log(`  • Type: ${analysis.likelyAppType}`);
  log(`  • Languages: ${analysis.languages.join(', ') || 'Unknown'}`);
  log(`  • Source files: ${analysis.sourceFileCount}`);
  log(`  • Tests detected: ${analysis.hasTests ? 'yes' : 'no'}`);
  log(`  • Custom Copilot agents: ${analysis.hasCustomAgents ? 'yes' : 'no'}`);
  log(`  • MCP config: ${analysis.hasMcpConfig ? 'yes' : 'no'}`);
  log();
  log('Suggested defaults:');
  log(`  • Model: ${defaultModel}`);
  log(`  • Primary agent: ${suggestedAgent}`);
  log();
  log('Next steps:');
  log('  • Review generated `AGENTS.md` files and refine any directory-specific rules');
  log('  • Add project-specific skills under `.omc/skills/<name>/SKILL.md` when reusable workflows emerge');
  log('  • Edit `oh-my-copilot.jsonc` if you want different default agents/models');
  log('  • Run `omc chat` or `omc run "<task>"` inside this repository');
  log();

  return {
    targetDir,
    configPath,
    contextPath,
    configAlreadyExists,
    availableModels,
    defaultModel,
    suggestedAgent,
    analysis,
    agentsFiles,
  };
}
