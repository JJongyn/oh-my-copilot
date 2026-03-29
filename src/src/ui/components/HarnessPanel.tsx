import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessTeam } from '../../harness/types';
import { SelectList, type SelectItem } from './SelectList';

interface HarnessPanelProps {
  team: HarnessTeam | null;
  onGenerate: () => void | Promise<void>;
  onClose: () => void;
  width?: number;
}

export function HarnessPanel({ team, onGenerate, onClose, width = 76 }: HarnessPanelProps) {
  const actions: SelectItem[] = [
    {
      id: 'generate',
      label: team ? 'Regenerate harness' : 'Generate harness',
      description: team
        ? 'Delete the current generated harness and build a new one for this project'
        : 'Create a new project-specific harness team and activate it in this session',
    },
    {
      id: 'close',
      label: 'Close',
      description: 'Return to the chat without changing the current harness team',
    },
  ];

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1} width={width}>
        <Text bold color="magenta">Harness</Text>
        <Text> </Text>
        {team ? (
          <>
            <Text>{team.summary}</Text>
            <Text color="gray" dimColor>{`Pattern: ${team.pattern} · Executor: ${team.recommendedExecutor}`}</Text>
            <Text color="gray" dimColor>{`Generation: ${team.generationMode ?? 'unknown'}${team.modelUsed ? ` · Model: ${team.modelUsed}` : ''}`}</Text>
            {team.generationWarning && <Text color="yellow">{team.generationWarning}</Text>}
            <Text> </Text>
            <Text bold>Generated Agents</Text>
            {team.agents.map(agent => (
              <Text key={agent.name} color="cyan">{`- ${agent.name} (${agent.role})`}</Text>
            ))}
            <Text> </Text>
            <Text bold>Generated Skills</Text>
            {team.skills.map(skill => (
              <Text key={skill.name} color="green">{`- ${skill.name}`}</Text>
            ))}
          </>
        ) : (
          <Text color="gray">No harness team generated for this project yet.</Text>
        )}
      </Box>
      <SelectList
        title="Harness Actions"
        items={actions}
        width={width}
        maxVisible={4}
        onSelect={(item) => {
          if (item.id === 'generate') {
            void onGenerate();
            return;
          }
          onClose();
        }}
        onCancel={onClose}
      />
    </Box>
  );
}
