/**
 * Agent picker — shows built-in + custom agents (project, VS Code, global).
 * Groups agents by role: Primary (orchestrators) and Specialist (subagents).
 */
import React from 'react';
import { SelectList, type SelectItem } from './SelectList';
import { listAgents } from '../../agents/builtin-agents';
import { loadCustomAgents } from '../../agents/custom-agent-loader';
import type { AgentSource } from '../../agents/custom-agent-loader';

interface AgentPickerProps {
  currentAgent: string;
  onSelect: (agent: string) => void;
  onCancel: () => void;
  width?: number;
}

const SOURCE_BADGE: Record<AgentSource, string> = {
  project: '.github',
  vscode: 'vscode',
  global: 'global',
};

const ROLE_BADGE: Record<string, string> = {
  primary: 'primary',
  subagent: 'specialist',
  all: '',
};

export function AgentPicker({ currentAgent, onSelect, onCancel, width = 60 }: AgentPickerProps) {
  const builtinAgents = listAgents(process.cwd());
  const customAgents = loadCustomAgents(process.cwd());

  const builtinNames = new Set(builtinAgents.map(a => a.name));
  const dedupedCustom = customAgents.filter(a => !builtinNames.has(a.name));

  const isActive = (name: string) => name === currentAgent;

  // Sort: primary/all agents first, then subagents
  const sorted = [...builtinAgents].sort((a, b) => {
    const order: Record<string, number> = { primary: 0, all: 1, subagent: 2 };
    return (order[a.mode] ?? 1) - (order[b.mode] ?? 1);
  });

  const builtinItems: SelectItem[] = sorted.map(a => ({
    id: a.name,
    label: a.name,
    description: a.description,
    badge: isActive(a.name) ? '* active' : (ROLE_BADGE[a.mode] || undefined),
  }));

  const customItems: SelectItem[] = dedupedCustom.map(a => ({
    id: a.name,
    label: a.name,
    description: a.description,
    badge: isActive(a.name) ? '* active' : SOURCE_BADGE[a.source],
  }));

  const items: SelectItem[] = customItems.length > 0
    ? [
        ...builtinItems,
        { id: '__sep__', label: '', separator: true },
        ...customItems,
      ]
    : builtinItems;

  return (
    <SelectList
      items={items}
      onSelect={(item) => onSelect(item.id)}
      onCancel={onCancel}
      title={`Agents  (${builtinItems.length} built-in${customItems.length > 0 ? `, ${customItems.length} custom` : ''})`}
      maxVisible={12}
      width={width}
    />
  );
}
