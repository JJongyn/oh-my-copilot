/**
 * AutoSetPanel.tsx
 * Conversational settings panel: parse natural language → apply agent/model/mode.
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { CopilotMode } from '../hooks/useChat';
import { parseSettingsIntent, type ParsedSettings } from '../../utils/settings-parser';

interface AutoSetPanelProps {
  currentAgent: string;
  currentModel: string;
  currentMode: CopilotMode;
  availableModels: string[];
  onApply: (settings: ParsedSettings) => void;
  onCancel: () => void;
  width: number;
}

type PanelState =
  | { stage: 'input' }
  | { stage: 'preview'; parsed: ParsedSettings }
  | { stage: 'disambiguate'; parsed: ParsedSettings; ambiguityIndex: number; resolved: ParsedSettings };

export function AutoSetPanel({
  currentAgent,
  currentModel,
  currentMode,
  availableModels,
  onApply,
  onCancel,
  width,
}: AutoSetPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [panelState, setPanelState] = useState<PanelState>({ stage: 'input' });
  const applyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    };
  }, []);

  // Handle numeric key presses during disambiguation
  useInput((ch, key) => {
    if (key.escape) {
      if (applyTimerRef.current) {
        clearTimeout(applyTimerRef.current);
        applyTimerRef.current = null;
      }
      onCancel();
      return;
    }

    if (panelState.stage === 'disambiguate') {
      const num = parseInt(ch, 10);
      if (isNaN(num)) return;

      const { parsed, ambiguityIndex, resolved } = panelState;
      const ambiguities = parsed.ambiguities ?? [];
      const current = ambiguities[ambiguityIndex];
      if (!current) return;

      const chosen = current.options[num - 1];
      if (!chosen) return;

      // Merge the choice into resolved
      const newResolved: ParsedSettings = { ...resolved, [current.field]: chosen };

      if (ambiguityIndex + 1 < ambiguities.length) {
        // Move to next ambiguity
        setPanelState({ stage: 'disambiguate', parsed, ambiguityIndex: ambiguityIndex + 1, resolved: newResolved });
      } else {
        // All resolved — apply
        onApply(newResolved);
      }
    }
  });

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      onCancel();
      return;
    }

    const parsed = parseSettingsIntent(trimmed, availableModels);

    if (parsed.ambiguities && parsed.ambiguities.length > 0) {
      // Start disambiguation — carry over non-ambiguous fields
      const resolved: ParsedSettings = {};
      if (parsed.agent) resolved.agent = parsed.agent;
      if (parsed.model) resolved.model = parsed.model;
      if (parsed.mode) resolved.mode = parsed.mode;
      setPanelState({ stage: 'disambiguate', parsed, ambiguityIndex: 0, resolved });
    } else if (parsed.agent || parsed.model || parsed.mode) {
      setPanelState({ stage: 'preview', parsed });
      // Auto-apply after a brief render cycle
      applyTimerRef.current = setTimeout(() => onApply(parsed), 300);
    } else {
      // Nothing matched
      setPanelState({ stage: 'input' });
      setInputValue('');
    }
  };

  const innerWidth = Math.max(width - 4, 20);

  const renderPreviewLines = (s: ParsedSettings) => {
    const parts: string[] = [];
    if (s.agent) parts.push(`agent=${s.agent}`);
    if (s.model) parts.push(`model=${s.model}`);
    if (s.mode) parts.push(`mode=${s.mode}`);
    return parts.length > 0 ? parts.join(', ') : '(nothing to apply)';
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Text bold color="cyan">Auto Set</Text>
      <Text> </Text>

      {/* Current settings summary */}
      <Box>
        <Text color="gray">Current: </Text>
        <Text color="yellow">agent=</Text><Text>{currentAgent}</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">model=</Text><Text>{currentModel}</Text>
        <Text color="gray"> | </Text>
        <Text color="yellow">mode=</Text><Text>{currentMode}</Text>
      </Box>

      <Text> </Text>

      {panelState.stage === 'input' && (
        <Box flexDirection="column">
          <Text color="gray" dimColor>Describe settings (e.g. 'sisyphus agent, gpt-4o-mini model')</Text>
          <Box>
            <Text color="cyan">{'> '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="e.g. use sisyphus with gpt-4o in agent mode"
            />
          </Box>
          <Text> </Text>
          <Text color="gray" dimColor>Esc to cancel</Text>
        </Box>
      )}

      {panelState.stage === 'preview' && (
        <Box flexDirection="column">
          <Text color="green">Applying: {renderPreviewLines(panelState.parsed)}</Text>
        </Box>
      )}

      {panelState.stage === 'disambiguate' && (() => {
        const { parsed, ambiguityIndex, resolved } = panelState;
        const ambiguities = parsed.ambiguities ?? [];
        const current = ambiguities[ambiguityIndex];
        if (!current) return null;

        return (
          <Box flexDirection="column">
            <Text color="yellow">
              Multiple {current.field}s match "{current.query}" — pick one:
            </Text>
            <Text> </Text>
            {current.options.map((opt, idx) => (
              <Box key={opt}>
                <Text color="cyan">{idx + 1}. </Text>
                <Text>{opt}</Text>
              </Box>
            ))}
            <Text> </Text>
            {Object.keys(resolved).length > 0 && (
              <Text color="gray" dimColor>
                Already resolved: {renderPreviewLines(resolved)}
              </Text>
            )}
            <Text color="gray" dimColor>Press 1–{current.options.length} to select, Esc to cancel</Text>
          </Box>
        );
      })()}
    </Box>
  );
}
