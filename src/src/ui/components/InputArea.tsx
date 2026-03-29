import React from 'react';
import { Box, Text } from 'ink';
import { CustomTextInput } from './CustomTextInput';
import type { Status } from '../hooks/useChat';

interface InputAreaProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  status: Status;
  width: number;
  paletteOpen?: boolean;
  onTabAgent?: () => void;
}

const HINT_NORMAL = 'Enter send  /commands  Tab next agent  Ctrl+C quit';
const HINT_PALETTE = 'up/down select  Enter confirm  Esc cancel';
const HINT_STREAMING = '/stop or Esc Esc to cancel  waiting for response...';

export function InputArea({ value, onChange, onSubmit, status, width, paletteOpen, onTabAgent }: InputAreaProps) {
  const isDisabled = status === 'streaming';

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="double"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={paletteOpen ? 'cyan' : isDisabled ? 'yellow' : 'cyan'}
      paddingX={1}
    >
      <Box gap={1} minHeight={1}>
        {isDisabled ? (
          <>
            <Text color="yellow">~</Text>
            <Text color="gray" dimColor>working... (/stop to cancel)</Text>
          </>
        ) : (
          <>
            <Text color={paletteOpen ? 'cyan' : 'white'} bold>&gt;</Text>
            {paletteOpen && <Text color="cyan">/</Text>}
            <CustomTextInput
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              onTab={onTabAgent ? () => onTabAgent() : undefined}
              placeholder={paletteOpen ? 'filter commands...' : 'Message or / for commands...'}
              focus={!isDisabled}
            />
          </>
        )}
      </Box>
      <Box>
        <Text color="gray" dimColor>
          {(isDisabled ? HINT_STREAMING : paletteOpen ? HINT_PALETTE : HINT_NORMAL).slice(0, width - 4)}
        </Text>
      </Box>
    </Box>
  );
}
