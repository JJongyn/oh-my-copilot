/**
 * Built-in tools available to agents.
 * Enhanced tool set inspired by oh-my-openagent's capabilities.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  output: string;
  error?: boolean;
}

export const TOOL_DEFINITIONS = [
  {
    name: 'run_terminal',
    description: 'Execute a shell command and return its output. Use for running scripts, installing packages, running tests, git operations, etc.',
    parameters: {
      command: 'string — the shell command to run',
      cwd: 'string? — working directory (default: project root)',
      timeout: 'number? — timeout in ms (default: 30000)',
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content.',
    parameters: {
      path: 'string — file path (relative to project root)',
      content: 'string — file content',
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file. Use this instead of write_file when making small changes to existing files. The old_string must be unique in the file.',
    parameters: {
      path: 'string — file path (relative to project root)',
      old_string: 'string — exact text to find (must be unique in file)',
      new_string: 'string — replacement text',
    },
  },
  {
    name: 'read_file',
    description: 'Read a file and return its content with line numbers.',
    parameters: {
      path: 'string — file path (relative to project root)',
      start_line: 'number? — start line (1-indexed, default: 1)',
      end_line: 'number? — end line (default: end of file)',
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at a given path. Use recursive option for tree views.',
    parameters: {
      path: 'string — directory path (default: ".")',
      recursive: 'boolean? — list recursively (default: false, max depth 3)',
      pattern: 'string? — glob pattern filter (e.g. "*.ts", "*.tsx")',
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern in files (grep-style). Returns matching lines with file paths and line numbers.',
    parameters: {
      pattern: 'string — search pattern (regex supported)',
      path: 'string? — directory to search (default: ".")',
      include: 'string? — file pattern to include (e.g. "*.ts")',
      context: 'number? — lines of context around matches (default: 0)',
    },
  },
  {
    name: 'git',
    description: 'Run git commands. Use for status, diff, log, blame, branch operations.',
    parameters: {
      args: 'string — git arguments (e.g. "status", "diff --stat", "log --oneline -10")',
    },
  },
  {
    name: 'call_agent',
    description: 'Invoke a specialist sub-agent to handle a focused task. The sub-agent runs independently and returns its result. Use oracle for architecture review, explore for codebase search, metis for scope review, momus for plan verification, librarian for documentation research.',
    parameters: {
      agent: 'string — agent name: oracle, explore, metis, momus, librarian',
      task: 'string — the specific task or question for the sub-agent',
    },
  },
  {
    name: 'spawn_agent',
    description: 'Launch a specialist sub-agent in the background and continue working without waiting. The result will be injected back into the conversation when it finishes.',
    parameters: {
      agent: 'string — agent name: oracle, explore, metis, momus, librarian',
      task: 'string — the background task to run',
    },
  },
  {
    name: 'list_background_agents',
    description: 'List currently running or completed background agent tasks and their statuses.',
    parameters: {},
  },
  {
    name: 'read_background_agent',
    description: 'Read the current status or final result of a specific background agent task.',
    parameters: {
      id: 'string — background task id returned by spawn_agent',
    },
  },
  {
    name: 'list_sessions',
    description: 'List recent saved sessions so the agent can resume or inspect prior work without carrying all history in the current context.',
    parameters: {
      limit: 'number? — max sessions to list (default: 10)',
      query: 'string? — optional search query for title, agent, or cwd',
    },
  },
  {
    name: 'read_session',
    description: 'Read one saved session as markdown so the agent can recover prior context on demand.',
    parameters: {
      id: 'string — session id or short prefix',
    },
  },
];

export const TOOLS_SYSTEM_PROMPT = `
## Tools

You have access to the following tools to actually perform tasks.
IMPORTANT: When asked to create files, run commands, or make changes — USE THESE TOOLS. Do not just describe what to do.

To call a tool, output a JSON block wrapped in <tool> tags:
<tool>{"name": "tool_name", "args": {"arg1": "value1"}}</tool>

You can call multiple tools in a single response. Independent operations should be called together for parallel execution.

Available tools:
${TOOL_DEFINITIONS.map(t =>
  `- **${t.name}**(${Object.entries(t.parameters).map(([k, v]) => `${k}: ${v}`).join(', ')})\n  ${t.description}`
).join('\n')}

### Tool Usage Guidelines
- **read_file** before editing — always understand context first
- **edit_file** for small changes to existing files (preferred over write_file for modifications)
- **write_file** only for new files or complete rewrites
- **search_files** to find patterns across the codebase
- **git** for version control operations (status, diff, log, blame)
- **run_terminal** for running tests, builds, and other commands
- **spawn_agent** when a subtask can run in the background while you continue local work
- **list_background_agents** and **read_background_agent** to inspect background work
- **list_sessions** and **read_session** to recover earlier work without keeping it in the live context window
- After modifying a file, verify by reading it back or running relevant tests
`;

function safePath(filePath: string, cwd: string): string {
  const resolved = path.resolve(cwd, filePath);
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`Path "${filePath}" is outside the working directory`);
  }
  return resolved;
}

function addLineNumbers(content: string, startLine = 1): string {
  const lines = content.split('\n');
  const maxWidth = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(maxWidth)}│ ${line}`)
    .join('\n');
}

function collectContextFiles(targetPath: string, cwd: string): string[] {
  const contextFiles: string[] = [];
  const isDirectory = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
  let currentDir = isDirectory ? targetPath : path.dirname(targetPath);
  const root = cwd;

  while (true) {
    for (const fileName of ['AGENTS.md', 'README.md']) {
      const candidate = path.join(currentDir, fileName);
      if (fs.existsSync(candidate) && candidate !== targetPath) {
        contextFiles.push(candidate);
      }
    }
    if (currentDir === root) break;
    const parent = path.dirname(currentDir);
    if (parent === currentDir || !currentDir.startsWith(root)) break;
    currentDir = parent;
  }

  return Array.from(new Set(contextFiles.reverse()));
}

function buildInjectedContext(targetPath: string, cwd: string): string {
  const relTarget = path.relative(cwd, targetPath);
  const contextFiles = collectContextFiles(targetPath, cwd);
  if (contextFiles.length === 0) return '';

  const blocks = contextFiles.map(filePath => {
    const rel = path.relative(cwd, filePath);
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const excerpt = raw.split('\n').slice(0, 80).join('\n');
    return `--- ${rel} ---\n${excerpt}`;
  });

  return [
    `Injected context for ${relTarget}:`,
    ...blocks,
    '--- end injected context ---',
    '',
  ].join('\n');
}

function listRecursive(dir: string, cwd: string, depth = 0, maxDepth = 3, pattern?: string): string[] {
  if (depth > maxDepth) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  const indent = '  '.repeat(depth);

  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth === 0 && entry.name !== '.github') continue;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;

    const rel = path.relative(cwd, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      results.push(`${indent}${entry.name}/`);
      results.push(...listRecursive(path.join(dir, entry.name), cwd, depth + 1, maxDepth, pattern));
    } else {
      if (pattern) {
        const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        if (!re.test(entry.name)) continue;
      }
      results.push(`${indent}${entry.name}`);
    }
  }
  return results;
}

/** Build a compact project context string for injection into the system prompt */
export function getProjectContext(cwd: string): string {
  const lines: string[] = [];

  // Working directory
  lines.push(`Working directory: ${cwd}`);

  // package.json name + description
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const name = pkg.name as string | undefined;
      const desc = pkg.description as string | undefined;
      if (name) lines.push(`Project: ${name}${desc ? ` — ${desc}` : ''}`);
    }
  } catch { /* ignore */ }

  // File tree (depth 3, max 120 lines)
  try {
    const tree = listRecursive(cwd, cwd, 0, 3);
    const truncated = tree.slice(0, 120);
    if (truncated.length > 0) {
      lines.push('');
      lines.push('File tree:');
      lines.push(...truncated);
      if (tree.length > 120) lines.push(`  ... (${tree.length - 120} more files)`);
    }
  } catch { /* ignore */ }

  // Project init context generated by `omc init`
  try {
    const contextPath = path.join(cwd, '.omc', 'project-context.md');
    if (fs.existsSync(contextPath)) {
      const raw = fs.readFileSync(contextPath, 'utf8').trim();
      if (raw) {
        const excerpt = raw.split('\n').slice(0, 40).join('\n');
        lines.push('');
        lines.push('Initialized project context:');
        lines.push(excerpt);
      }
    }
  } catch { /* ignore */ }

  return lines.join('\n');
}

export async function executeTool(call: ToolCall, cwd: string): Promise<ToolResult> {
  const { name, args } = call;

  try {
    switch (name) {
      case 'run_terminal': {
        const command = String(args.command ?? '');
        const workdir = args.cwd ? safePath(String(args.cwd), cwd) : cwd;
        const timeout = Number(args.timeout) || 30_000;
        const output = execSync(command, {
          cwd: workdir,
          encoding: 'utf8',
          timeout,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, FORCE_COLOR: '0' },
        });
        return { name, output: output.trim() || '(no output)' };
      }

      case 'write_file': {
        const filePath = safePath(String(args.path ?? ''), cwd);
        const content = String(args.content ?? '');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        const rel = path.relative(cwd, filePath);
        return { name, output: `Written ${rel} (${content.length} bytes)` };
      }

      case 'edit_file': {
        const filePath = safePath(String(args.path ?? ''), cwd);
        const oldStr = String(args.old_string ?? '');
        const newStr = String(args.new_string ?? '');

        if (!fs.existsSync(filePath)) {
          return { name, output: `File not found: ${path.relative(cwd, filePath)}`, error: true };
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const occurrences = content.split(oldStr).length - 1;

        if (occurrences === 0) {
          return { name, output: `old_string not found in ${path.relative(cwd, filePath)}. Read the file first to get the exact text.`, error: true };
        }
        if (occurrences > 1) {
          return { name, output: `old_string found ${occurrences} times in ${path.relative(cwd, filePath)}. Provide a more unique string with surrounding context.`, error: true };
        }

        const newContent = content.replace(oldStr, newStr);
        fs.writeFileSync(filePath, newContent, 'utf8');
        const rel = path.relative(cwd, filePath);
        return { name, output: `Edited ${rel} (replaced ${oldStr.length} chars with ${newStr.length} chars)` };
      }

      case 'read_file': {
        const filePath = safePath(String(args.path ?? ''), cwd);
        const injected = buildInjectedContext(filePath, cwd);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const startLine = Math.max(1, Number(args.start_line) || 1);
        const endLine = Math.min(lines.length, Number(args.end_line) || lines.length);
        const sliced = lines.slice(startLine - 1, endLine).join('\n');
        const rel = path.relative(cwd, filePath);
        const header = `${rel} (${lines.length} lines)`;
        return { name, output: `${injected}${header}\n${addLineNumbers(sliced, startLine)}` };
      }

      case 'list_files': {
        const dirPath = safePath(String(args.path ?? '.'), cwd);
        const recursive = args.recursive === true || args.recursive === 'true';
        const pattern = args.pattern ? String(args.pattern) : undefined;

        if (recursive) {
          const results = listRecursive(dirPath, cwd, 0, 3, pattern);
          return { name, output: results.join('\n') || '(empty directory)' };
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = entries
          .filter(e => {
            if (pattern) {
              const re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
              return e.isDirectory() || re.test(e.name);
            }
            return true;
          })
          .map(e => (e.isDirectory() ? `${e.name}/` : e.name));
        return { name, output: lines.join('\n') || '(empty directory)' };
      }

      case 'search_files': {
        const pattern = String(args.pattern ?? '');
        const searchPath = args.path ? safePath(String(args.path), cwd) : cwd;
        const include = args.include ? `--include="${args.include}"` : '--include="*"';
        const contextFlag = args.context ? `-C ${Number(args.context)}` : '';

        const output = execSync(
          `grep -rn ${contextFlag} ${include} -e "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -100 || echo "(no matches)"`,
          { cwd, encoding: 'utf8', timeout: 10_000 },
        );

        // Make paths relative
        const result = output
          .trim()
          .split('\n')
          .map(line => line.replace(cwd + '/', ''))
          .join('\n');

        return { name, output: result };
      }

      case 'git': {
        const gitArgs = String(args.args ?? 'status');
        const parts = gitArgs.trim().split(/\s+/).filter(Boolean);
        const result = spawnSync('git', parts, {
          cwd,
          encoding: 'utf8',
          timeout: 15_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        if (result.error) throw result.error;
        const out = (result.stdout ?? '') + (result.stderr ?? '');
        return { name, output: out.trim() || '(no output)' };
      }

      default:
        return { name, output: `Unknown tool: ${name}`, error: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // For exec errors, extract just the stderr/message, not the full stack
    const clean = msg.includes('Command failed:')
      ? msg.split('\n').filter(l => !l.includes('    at ')).join('\n').trim()
      : msg;
    return { name, output: `Error: ${clean}`, error: true };
  }
}

/** Parse all <tool>...</tool> blocks from a response string */
export function parseToolCalls(text: string): { calls: ToolCall[]; cleanText: string } {
  const calls: ToolCall[] = [];
  const cleanText = text.replace(/<tool>([\s\S]*?)<\/tool>/g, (_, json) => {
    try {
      const call = JSON.parse(json.trim()) as ToolCall;
      if (call.name) calls.push(call);
    } catch {
      // malformed tool call — ignore
    }
    return '';
  }).trim();
  return { calls, cleanText };
}
