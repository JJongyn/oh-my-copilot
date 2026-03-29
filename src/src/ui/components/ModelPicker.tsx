/**
 * Model picker — shows available Copilot models fetched from bridge.
 * Keyboard navigable, triggered by /model command.
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SelectList, type SelectItem } from './SelectList';
import type { CopilotBridgeProvider } from '../../provider/copilot-bridge';

interface ModelPickerProps {
  provider: CopilotBridgeProvider;
  currentModel: string;
  onSelect: (model: string) => void;
  onCancel: () => void;
  width?: number;
}

export function ModelPicker({ provider, currentModel, onSelect, onCancel, width = 60 }: ModelPickerProps) {
  const [items, setItems] = useState<SelectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    provider.listModels()
      .then((models) => {
        const seen = new Set<string>();
        const deduped: SelectItem[] = [];
        for (const m of models) {
          const key = m.family || m.id;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push({
              id: key,
              label: key,
              description: m.name !== key ? m.name : undefined,
              badge: key === currentModel ? '● current' : undefined,
              sublabel: m.maxInputTokens
                ? `${(m.maxInputTokens / 1000).toFixed(0)}k tokens max`
                : undefined,
            });
          }
        }
        setItems(deduped);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Box borderStyle="round" borderColor="cyan" width={width} paddingX={1}>
        <Text color="yellow">⠿ Loading models…</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box borderStyle="round" borderColor="red" width={width} paddingX={1}>
        <Text color="red">✗ {error}</Text>
      </Box>
    );
  }

  return (
    <SelectList
      items={items}
      onSelect={(item) => onSelect(item.id)}
      onCancel={onCancel}
      title="Select Model"
      maxVisible={8}
      width={width}
    />
  );
}
