import React from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectList, type SelectItem } from './SelectList';
import type { BackgroundAgentManager } from '../../agent-runtime/background-agent-manager';

interface BackgroundTaskPickerProps {
  manager: BackgroundAgentManager;
  onClose: () => void;
  width?: number;
}

function EmptyState({ onClose, width }: { onClose: () => void; width: number }) {
  useInput((_input, key) => {
    if (key.escape || key.return) onClose();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} width={width}>
      <Text bold>Background Tasks</Text>
      <Text> </Text>
      <Text color="gray">No background agent tasks yet.</Text>
      <Text color="gray" dimColor>Use `spawn_agent` in agent mode to run one.</Text>
      <Text> </Text>
      <Text color="gray" dimColor>Press Esc or Enter to close</Text>
    </Box>
  );
}

export function BackgroundTaskPicker({ manager, onClose, width = 80 }: BackgroundTaskPickerProps) {
  const tasks = manager.list().slice().reverse();
  if (tasks.length === 0) {
    return <EmptyState onClose={onClose} width={width} />;
  }

  const items: SelectItem[] = tasks.map(task => ({
    id: task.id,
    label: `${task.id}  ${task.agent}`,
    description: task.status === 'completed'
      ? (task.result ?? '(no result)').slice(0, width - 10)
      : task.status === 'failed'
        ? `ERROR: ${(task.error ?? '').slice(0, width - 18)}`
        : task.task.slice(0, width - 10),
    badge: task.status === 'running' ? '● running' : task.status === 'completed' ? '✓ done' : '✗ failed',
  }));

  return (
    <SelectList
      items={items}
      onSelect={() => onClose()}
      onCancel={onClose}
      title={`Background Tasks (${manager.runningCount()}/${manager.maxConcurrentCount()} running)`}
      maxVisible={10}
      width={width}
    />
  );
}
