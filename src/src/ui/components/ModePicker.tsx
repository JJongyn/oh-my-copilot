/**
 * Copilot mode picker — ask / plan / agent
 * Enhanced with clearer descriptions of each mode's capabilities.
 */
import React from 'react';
import { SelectList, type SelectItem } from './SelectList';
import type { CopilotMode } from '../hooks/useChat';

interface ModePickerProps {
  currentMode: CopilotMode;
  onSelect: (mode: CopilotMode) => void;
  onCancel: () => void;
  width?: number;
}

const MODE_ITEMS: SelectItem[] = [
  {
    id: 'harness',
    label: 'harness',
    description: 'Generated team mode — existing executor uses harness-generated agents and skills first',
    badge: undefined,
  },
  {
    id: 'ultrawork',
    label: 'ultrawork',
    description: 'Maximum autonomy — agent works, Oracle verifies, fixes until PASS (oh-my-openagent style)',
    badge: undefined,
  },
  {
    id: 'agent',
    label: 'agent',
    description: 'Full autonomous mode — uses tools, loops until done, self-verifies',
    badge: undefined,
  },
  {
    id: 'plan',
    label: 'plan',
    description: 'Planning mode — analyzes codebase (read-only tools), generates execution plan',
    badge: undefined,
  },
  {
    id: 'ask',
    label: 'ask',
    description: 'Direct Q&A — fast answers, no tools',
    badge: undefined,
  },
];

export function ModePicker({ currentMode, onSelect, onCancel, width = 60 }: ModePickerProps) {
  const items = MODE_ITEMS.map(item => ({
    ...item,
    badge: item.id === currentMode ? '* active' : undefined,
  }));

  return (
    <SelectList
      items={items}
      onSelect={(item) => onSelect(item.id as CopilotMode)}
      onCancel={onCancel}
      title="Select Mode"
      maxVisible={5}
      width={width}
    />
  );
}
