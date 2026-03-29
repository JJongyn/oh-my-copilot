import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '../config/types';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class McpClientManager {
  private clients = new Map<string, Client>();
  private tools = new Map<string, { tool: McpTool; client: Client }>();

  private splitCommand(command: string): string[] {
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    return parts.map(part => part.replace(/^"|"$/g, ''));
  }

  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.clients.has(name)) return;
    if (config.enabled === false) return;

    const client = new Client({ name: `oh-my-copilot/${name}`, version: '1.0.0' });

    if (config.type === 'stdio') {
      if (!config.command) throw new Error(`MCP server "${name}" requires a command`);

      const parts = this.splitCommand(config.command);
      const [cmd, ...defaultArgs] = parts;
      const args = [...defaultArgs, ...(config.args ?? [])];

      const transport = new StdioClientTransport({
        command: cmd,
        args,
        env: config.env,
        cwd: config.cwd,
      });
      await client.connect(transport);
    } else if (config.type === 'http') {
      if (!config.url) throw new Error(`MCP server "${name}" requires a url`);
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers,
        },
      });
      await client.connect(transport);
    } else {
      throw new Error(`MCP transport type "${config.type}" is not yet supported in oh-my-copilot`);
    }

    this.clients.set(name, client);

    // Discover tools
    const { tools } = await client.listTools();
    for (const tool of tools) {
      this.tools.set(`${name}__${tool.name}`, {
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
          serverName: name,
        },
        client,
      });
    }
  }

  async connectAll(servers: Record<string, McpServerConfig>): Promise<{ name: string; error: string }[]> {
    const errors: { name: string; error: string }[] = [];
    await Promise.all(
      Object.entries(servers).map(async ([name, config]) => {
        try {
          await this.connectServer(name, config);
        } catch (err) {
          errors.push({ name, error: String(err) });
        }
      })
    );
    return errors;
  }

  connectedServerCount(): number {
    return this.clients.size;
  }

  listTools(): McpTool[] {
    return Array.from(this.tools.values()).map(({ tool }) => tool);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const key = `${serverName}__${toolName}`;
    const entry = this.tools.get(key);
    if (!entry) throw new Error(`Tool "${toolName}" not found on server "${serverName}"`);

    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return result as McpToolResult;
  }

  getToolsAsOpenAIFunctions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.listTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: `${tool.serverName}__${tool.name}`,
        description: tool.description ?? `Tool ${tool.name} from ${tool.serverName}`,
        parameters: tool.inputSchema,
      },
    }));
  }

  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.tools.clear();
  }
}
