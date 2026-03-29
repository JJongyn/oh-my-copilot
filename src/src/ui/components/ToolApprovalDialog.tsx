import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface PendingToolApproval {
  toolName: string;
  summary: string;
  details?: string;
}

interface ToolApprovalDialogProps {
  approval: PendingToolApproval;
  onApprove: () => void;
  onDeny: () => void;
  width?: number;
}

export function ToolApprovalDialog({ approval, onApprove, onDeny, width = 76 }: ToolApprovalDialogProps) {
  useInput((input, key) => {
    if (key.return || input.toLowerCase() === 'y') onApprove();
    if (key.escape || input.toLowerCase() === 'n') onDeny();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} width={width}>
      <Text bold color="yellow">Terminal Permission Required</Text>
      <Text> </Text>
      <Text>{approval.summary}</Text>
      {approval.details && (
        <>
          <Text> </Text>
          <Text color="gray" dimColor wrap="wrap">{approval.details.slice(0, Math.max(40, width - 6))}</Text>
        </>
      )}
      <Text> </Text>
      <Text color="green">Enter / Y approve</Text>
      <Text color="red">Esc / N deny</Text>
    </Box>
  );
}
