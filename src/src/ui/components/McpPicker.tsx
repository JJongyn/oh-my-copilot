import React from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectList, type SelectItem } from './SelectList';
import type { McpClientManager } from '../../mcp/mcp-client';
import { loadMcpConfig } from '../../mcp/mcp-config';
import { loadConfig } from '../../config/config-manager';
import type { BridgeToolInfo } from '../../provider/types';
import { toBridgeToolCallName } from '../../provider/bridge-tools';

interface McpPickerProps {
  mcpClient?: McpClientManager;
  bridgeTools?: BridgeToolInfo[];
  onClose: () => void;
  width?: number;
}

function EmptyMcpState({ onClose, width }: { onClose: () => void; width: number }) {
  useInput((_input, key) => {
    if (key.escape || key.return) onClose();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} width={width}>
      <Text bold>MCP & Editor Tools</Text>
      <Text> </Text>
      <Text color="gray">No MCP servers or editor tools detected.</Text>
      <Text color="gray" dimColor>Create .vscode/mcp.json, editor User/mcp.json, or ~/.oh-my-copilot/mcp.json</Text>
      <Text> </Text>
      <Text color="gray" dimColor>Press Esc or Enter to close</Text>
    </Box>
  );
}

export function McpPicker({ mcpClient, bridgeTools = [], onClose, width = 60 }: McpPickerProps) {
  const loadedConfig = loadConfig();
  const mcpConfig = loadMcpConfig(process.cwd(), loadedConfig);
  const serverNames = Object.keys(mcpConfig.servers);
  const connectedTools = mcpClient?.listTools() ?? [];
  const connectedServers = new Set(connectedTools.map(t => t.serverName));

  if (serverNames.length === 0 && bridgeTools.length === 0) {
    return <EmptyMcpState onClose={onClose} width={width} />;
  }

  const serverItems: SelectItem[] = serverNames.map(name => {
    const configEntry = mcpConfig.servers[name];
    const isConnected = connectedServers.has(name);
    const toolCount = connectedTools.filter(t => t.serverName === name).length;
    return {
      id: `server:${name}`,
      label: name,
      description: isConnected
        ? `${toolCount} tool${toolCount !== 1 ? 's' : ''} connected · ${configEntry.sourceScope ?? 'workspace'}`
        : `${configEntry.autoStart === false ? 'configured, auto-start off' : 'configured, not connected'} · ${configEntry.sourceScope ?? 'workspace'}`,
      badge: configEntry.enabled === false ? '⊘ disabled' : isConnected ? '● on' : '○ off',
    };
  });
  const bridgeItems: SelectItem[] = bridgeTools.map(tool => ({
    id: `tool:${tool.name}`,
    label: toBridgeToolCallName(tool.name),
    description: tool.description || 'VS Code/Copilot editor tool',
    badge: 'bridge',
  }));
  const items: SelectItem[] = [...serverItems, ...bridgeItems];

  return (
    <SelectList
      items={items}
      onSelect={() => onClose()}
      onCancel={onClose}
      title="MCP & Editor Tools"
      maxVisible={10}
      width={width}
    />
  );
}
