"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpClientManager = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
class McpClientManager {
    constructor() {
        this.clients = new Map();
        this.tools = new Map();
    }
    async connectServer(name, config) {
        if (this.clients.has(name))
            return;
        const client = new index_js_1.Client({ name: `oh-my-copilot/${name}`, version: '1.0.0' });
        if (config.type === 'stdio') {
            if (!config.command)
                throw new Error(`MCP server "${name}" requires a command`);
            const parts = config.command.split(' ');
            const [cmd, ...defaultArgs] = parts;
            const args = [...defaultArgs, ...(config.args ?? [])];
            const transport = new stdio_js_1.StdioClientTransport({
                command: cmd,
                args,
                env: config.env,
            });
            await client.connect(transport);
        }
        else {
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
                    inputSchema: tool.inputSchema,
                    serverName: name,
                },
                client,
            });
        }
    }
    async connectAll(servers) {
        const errors = [];
        await Promise.all(Object.entries(servers).map(async ([name, config]) => {
            try {
                await this.connectServer(name, config);
            }
            catch (err) {
                errors.push({ name, error: String(err) });
            }
        }));
        return errors;
    }
    listTools() {
        return Array.from(this.tools.values()).map(({ tool }) => tool);
    }
    async callTool(serverName, toolName, args) {
        const key = `${serverName}__${toolName}`;
        const entry = this.tools.get(key);
        if (!entry)
            throw new Error(`Tool "${toolName}" not found on server "${serverName}"`);
        const result = await entry.client.callTool({ name: toolName, arguments: args });
        return result;
    }
    getToolsAsOpenAIFunctions() {
        return this.listTools().map(tool => ({
            type: 'function',
            function: {
                name: `${tool.serverName}__${tool.name}`,
                description: tool.description ?? `Tool ${tool.name} from ${tool.serverName}`,
                parameters: tool.inputSchema,
            },
        }));
    }
    async disconnectAll() {
        for (const [, client] of this.clients) {
            try {
                await client.close();
            }
            catch {
                // ignore
            }
        }
        this.clients.clear();
        this.tools.clear();
    }
}
exports.McpClientManager = McpClientManager;
