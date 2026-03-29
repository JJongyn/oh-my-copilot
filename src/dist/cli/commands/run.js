"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTask = runTask;
const process = __importStar(require("process"));
const copilot_bridge_1 = require("../../provider/copilot-bridge");
const session_manager_1 = require("../../session/session-manager");
const builtin_agents_1 = require("../../agents/builtin-agents");
const config_manager_1 = require("../../config/config-manager");
const mcp_client_1 = require("../../mcp/mcp-client");
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
async function runTask(task, options = {}) {
    const config = (0, config_manager_1.loadConfig)();
    const bridgeInfo = (0, copilot_bridge_1.readBridgeInfo)();
    if (!bridgeInfo) {
        const msg = 'Bridge not found. Open VS Code with oh-my-copilot-bridge extension installed.';
        if (options.json) {
            console.log(JSON.stringify({ error: msg }));
        }
        else {
            console.error(`${RED}Error: ${msg}${RESET}`);
        }
        process.exit(1);
    }
    const provider = new copilot_bridge_1.CopilotBridgeProvider(bridgeInfo);
    const healthy = await provider.checkHealth().catch(() => false);
    if (!healthy) {
        const msg = `Bridge not responding at 127.0.0.1:${bridgeInfo.port}. Ensure VS Code is open.`;
        if (options.json) {
            console.log(JSON.stringify({ error: msg }));
        }
        else {
            console.error(`${RED}Error: ${msg}${RESET}`);
        }
        process.exit(1);
    }
    const agentName = options.agent ?? 'sisyphus';
    const model = options.model ?? config.model ?? bridgeInfo.models[0] ?? 'gpt-4o';
    const sessionManager = new session_manager_1.SessionManager();
    // Load MCP servers if configured
    const mcpManager = new mcp_client_1.McpClientManager();
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
        const errors = await mcpManager.connectAll(config.mcpServers);
        if (errors.length > 0 && !options.json) {
            for (const { name, error } of errors) {
                console.warn(`${'\x1b[33m'}⚠ MCP server "${name}" failed to connect: ${error}${RESET}`);
            }
        }
    }
    let session = options.resume ? sessionManager.load(options.resume) : null;
    if (!session) {
        session = sessionManager.createSession(agentName, model, process.cwd());
    }
    const agentConfig = (0, builtin_agents_1.resolveAgent)(agentName, model, process.cwd(), session.meta.id);
    const messages = [
        { role: 'system', content: agentConfig.resolvedPrompt },
        ...session.messages,
        { role: 'user', content: task },
    ];
    sessionManager.addMessage(session, { role: 'user', content: task });
    if (!options.json) {
        console.log(`\n${BOLD}Task:${RESET} ${task}`);
        console.log(`${DIM}Agent: ${agentName} | Model: ${model} | Session: ${session.meta.id}${RESET}\n`);
        process.stdout.write(`${CYAN}Response${RESET}:\n\n`);
    }
    let fullResponse = '';
    try {
        for await (const chunk of provider.streamChat(messages, { model })) {
            if (chunk.done)
                break;
            fullResponse += chunk.content;
            if (!options.json) {
                process.stdout.write(chunk.content);
            }
        }
    }
    catch (err) {
        const errMsg = String(err);
        if (options.json) {
            console.log(JSON.stringify({ error: errMsg, sessionId: session.meta.id }));
        }
        else {
            console.error(`\n${RED}Error: ${errMsg}${RESET}`);
        }
        await mcpManager.disconnectAll();
        process.exit(1);
    }
    sessionManager.addMessage(session, { role: 'assistant', content: fullResponse });
    if (!session.meta.title) {
        session.meta.title = sessionManager.generateTitle(session.messages);
        sessionManager.save(session);
    }
    if (options.json) {
        console.log(JSON.stringify({
            response: fullResponse,
            sessionId: session.meta.id,
            agent: agentName,
            model,
        }));
    }
    else {
        console.log(`\n\n${DIM}Session saved: ${session.meta.id}${RESET}\n`);
    }
    await mcpManager.disconnectAll();
}
