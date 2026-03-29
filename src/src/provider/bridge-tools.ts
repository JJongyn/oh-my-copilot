import type { BridgeToolInfo, BridgeToolResultPart } from './types';

export const BRIDGE_TOOL_PREFIX = 'vscode__';

export function toBridgeToolCallName(toolName: string): string {
  return `${BRIDGE_TOOL_PREFIX}${toolName}`;
}

export function isBridgeToolCall(name: string): boolean {
  return name.startsWith(BRIDGE_TOOL_PREFIX);
}

export function fromBridgeToolCallName(name: string): string {
  return name.slice(BRIDGE_TOOL_PREFIX.length);
}

export function formatBridgeToolsSection(tools: BridgeToolInfo[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(tool =>
    `- **${toBridgeToolCallName(tool.name)}**: ${tool.description || tool.name}`,
  );
  return `\n\n## Copilot Editor Tools\n${lines.join('\n')}\n\nCall: <tool>{"name": "vscode__toolName", "args": {...}}</tool>`;
}

export function summarizeBridgeCapabilities(tools: BridgeToolInfo[]): string {
  if (tools.length === 0) return '';

  const buckets: Record<string, string[]> = {
    search: [],
    docs: [],
    browser: [],
    github: [],
  };

  for (const tool of tools) {
    const haystack = `${tool.name} ${tool.description} ${(tool.tags ?? []).join(' ')}`.toLowerCase();
    if (/(search|grep|find|exa|web)/.test(haystack)) buckets.search.push(tool.name);
    if (/(docs|documentation|context7|reference)/.test(haystack)) buckets.docs.push(tool.name);
    if (/(browser|playwright|page|screenshot|navigate)/.test(haystack)) buckets.browser.push(tool.name);
    if (/(github|issue|pull request|repository|repo)/.test(haystack)) buckets.github.push(tool.name);
  }

  const lines = Object.entries(buckets)
    .filter(([, names]) => names.length > 0)
    .map(([capability, names]) => `- ${capability}: ${Array.from(new Set(names)).join(', ')}`);

  if (lines.length === 0) return '';
  return `\n\n## Built-in Editor Capabilities\nUse these Copilot editor tools as built-in capabilities when relevant.\n${lines.join('\n')}`;
}

export function extractBridgeCapabilities(tools: BridgeToolInfo[]): string[] {
  const capabilities = new Set<string>();

  for (const tool of tools) {
    const haystack = `${tool.name} ${tool.description} ${(tool.tags ?? []).join(' ')}`.toLowerCase();
    if (/(search|grep|find|exa|web)/.test(haystack)) capabilities.add('search');
    if (/(docs|documentation|context7|reference)/.test(haystack)) capabilities.add('docs');
    if (/(browser|playwright|page|screenshot|navigate)/.test(haystack)) capabilities.add('browser');
    if (/(github|issue|pull request|repository|repo)/.test(haystack)) capabilities.add('github');
  }

  return Array.from(capabilities).sort();
}

export function bridgeToolResultToText(parts: BridgeToolResultPart[]): string {
  return parts
    .map(part => part.text ?? '')
    .filter(Boolean)
    .join('\n');
}
