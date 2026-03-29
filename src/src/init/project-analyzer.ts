import * as fs from 'fs';
import * as path from 'path';

export interface ProjectAnalysis {
  packageManagers: string[];
  languages: string[];
  hasReadme: boolean;
  hasTests: boolean;
  hasCi: boolean;
  hasDocker: boolean;
  hasMcpConfig: boolean;
  hasCustomAgents: boolean;
  likelyAppType: string;
  keyDirectories: string[];
  sourceFileCount: number;
  notes: string[];
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h',
]);

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function walk(dir: string, root: string, files: string[] = [], depth = 0): string[] {
  if (depth > 4) return files;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, root, files, depth + 1);
    } else {
      files.push(path.relative(root, fullPath));
    }
  }
  return files;
}

export function analyzeProject(cwd: string = process.cwd()): ProjectAnalysis {
  const allFiles = walk(cwd, cwd);
  const sourceFiles = allFiles.filter(file => SOURCE_EXTENSIONS.has(path.extname(file)));
  const packageManagers = [
    exists(path.join(cwd, 'package-lock.json')) ? 'npm' : null,
    exists(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : null,
    exists(path.join(cwd, 'yarn.lock')) ? 'yarn' : null,
    exists(path.join(cwd, 'bun.lockb')) || exists(path.join(cwd, 'bun.lock')) ? 'bun' : null,
  ].filter(Boolean) as string[];

  const languages = Array.from(new Set(sourceFiles.map(file => {
    const ext = path.extname(file);
    if (ext === '.ts' || ext === '.tsx') return 'TypeScript';
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'JavaScript';
    if (ext === '.py') return 'Python';
    if (ext === '.go') return 'Go';
    if (ext === '.rs') return 'Rust';
    if (ext === '.java' || ext === '.kt') return 'JVM';
    return ext.slice(1);
  })));

  const keyDirectories = ['src', 'app', 'packages', 'bridge', 'web', 'docs', 'scripts', 'tests', '__tests__']
    .filter(name => exists(path.join(cwd, name)));

  const hasTests = allFiles.some(file => /(^|\/)(test|tests|__tests__)\/|(\.test\.|\.spec\.)/i.test(file)) ||
    allFiles.some(file => file.includes('.test.') || file.includes('.spec.'));

  const hasCi = exists(path.join(cwd, '.github', 'workflows'));
  const hasDocker = allFiles.some(file => /(^|\/)Dockerfile|docker-compose/i.test(file));
  const hasMcpConfig = exists(path.join(cwd, '.vscode', 'mcp.json')) || exists(path.join(cwd, '.mcp.json'));
  const hasCustomAgents = exists(path.join(cwd, '.github', 'agents')) || exists(path.join(cwd, '.github', 'copilot'));

  let likelyAppType = 'general repository';
  if (exists(path.join(cwd, 'package.json')) && exists(path.join(cwd, 'src'))) likelyAppType = 'Node/TypeScript application';
  if (exists(path.join(cwd, 'bridge')) && exists(path.join(cwd, 'src'))) likelyAppType = 'CLI + VS Code extension monorepo';
  if (exists(path.join(cwd, 'web'))) likelyAppType = `${likelyAppType} with web assets`;

  const notes: string[] = [];
  if (languages.includes('TypeScript')) notes.push('Prefer strict typing and project-local build commands before broader refactors.');
  if (!hasTests) notes.push('No committed automated tests detected; verification should emphasize typecheck/build and targeted smoke tests.');
  if (hasCustomAgents) notes.push('Custom Copilot agents are already configured in this repository.');
  if (hasMcpConfig) notes.push('Repository includes MCP configuration; keep agent/tool scoping explicit.');

  return {
    packageManagers,
    languages,
    hasReadme: exists(path.join(cwd, 'README.md')),
    hasTests,
    hasCi,
    hasDocker,
    hasMcpConfig,
    hasCustomAgents,
    likelyAppType,
    keyDirectories,
    sourceFileCount: sourceFiles.length,
    notes,
  };
}

export function formatProjectAnalysisMarkdown(analysis: ProjectAnalysis, cwd: string = process.cwd()): string {
  return [
    '# Project Context',
    '',
    `Generated for: \`${cwd}\``,
    '',
    '## Snapshot',
    `- Type: ${analysis.likelyAppType}`,
    `- Languages: ${analysis.languages.join(', ') || 'Unknown'}`,
    `- Package managers: ${analysis.packageManagers.join(', ') || 'Unknown'}`,
    `- Source files detected: ${analysis.sourceFileCount}`,
    `- Key directories: ${analysis.keyDirectories.join(', ') || 'None detected'}`,
    '',
    '## Capabilities',
    `- README present: ${analysis.hasReadme ? 'yes' : 'no'}`,
    `- Tests detected: ${analysis.hasTests ? 'yes' : 'no'}`,
    `- CI detected: ${analysis.hasCi ? 'yes' : 'no'}`,
    `- Docker detected: ${analysis.hasDocker ? 'yes' : 'no'}`,
    `- MCP config detected: ${analysis.hasMcpConfig ? 'yes' : 'no'}`,
    `- Custom Copilot agents detected: ${analysis.hasCustomAgents ? 'yes' : 'no'}`,
    '',
    '## Working Notes',
    ...(analysis.notes.length > 0 ? analysis.notes.map(note => `- ${note}`) : ['- No additional notes.']),
    '',
  ].join('\n');
}
