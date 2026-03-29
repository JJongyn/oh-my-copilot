/**
 * Slash command palette — appears when user types "/" in the input.
 * Shows available commands filtered by what they've typed so far.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { SelectList, type SelectItem } from './SelectList';

export interface Command {
  id: string;
  label: string;
  description: string;
  args?: string;
}

const BUILTIN_COMMANDS: Command[] = [
  { id: 'agent',     label: '/agent',     description: 'Switch agent',                   args: '<name>' },
  { id: 'model',     label: '/model',     description: 'Switch model',                   args: '<name>' },
  { id: 'mode',      label: '/mode',      description: 'Switch mode (ask/plan/agent/ultrawork)' },
  { id: 'ultrawork', label: '/ultrawork', description: 'Ultrawork mode — Oracle verification loop (maximum autonomy)' },
  { id: 'init',      label: '/init',      description: 'Analyze this repository and scaffold project context' },
  { id: 'harness',   label: '/harness',   description: 'Generate, inspect, or regenerate a project-specific harness team' },
  { id: 'skills',    label: '/skills',    description: 'View and toggle skills for this session' },
  { id: 'new',       label: '/new',       description: 'Start a new session' },
  { id: 'sessions',  label: '/sessions',  description: 'Browse & manage sessions' },
  { id: 'clear',     label: '/clear',     description: 'Clear screen & new session' },
  { id: 'stop',      label: '/stop',      description: 'Stop current generation' },
  { id: 'mcp',       label: '/mcp',       description: 'View MCP servers & Copilot editor tools' },
  { id: 'background', label: '/background', description: 'View background agent tasks' },
  { id: 'shell',     label: '/shell',     description: 'Open terminal shell (exit to return)' },
  { id: 'auto-set',  label: '/auto_set',  description: 'Natural language settings' },
  { id: 'help',      label: '/help',      description: 'Show all commands' },
  { id: 'exit',      label: '/exit',      description: 'Exit oh-my-copilot' },
];

interface CommandPaletteProps {
  query: string;
  onSelect: (cmd: Command) => void;
  onCancel: () => void;
  width?: number;
}

export function CommandPalette({ query, onSelect, onCancel, width = 60 }: CommandPaletteProps) {
  const items: SelectItem[] = BUILTIN_COMMANDS.map((cmd) => ({
    id: cmd.id,
    label: cmd.label + (cmd.args ? ` ${cmd.args}` : ''),
    description: cmd.description,
  }));

  return (
    <Box flexDirection="column">
      <SelectList
        items={items}
        onSelect={(item) => {
          const cmd = BUILTIN_COMMANDS.find((c) => c.id === item.id);
          if (cmd) onSelect(cmd);
        }}
        onCancel={onCancel}
        title="Commands"
        maxVisible={8}
        width={width}
        filterQuery={query}
      />
    </Box>
  );
}

export { BUILTIN_COMMANDS };
