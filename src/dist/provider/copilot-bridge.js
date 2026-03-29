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
exports.CopilotBridgeProvider = exports.BridgeConnectionError = void 0;
exports.readBridgeInfo = readBridgeInfo;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const BRIDGE_INFO_PATH = path.join(os.homedir(), '.oh-my-copilot', 'bridge.json');
class BridgeConnectionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BridgeConnectionError';
    }
}
exports.BridgeConnectionError = BridgeConnectionError;
function readBridgeInfo() {
    try {
        if (!fs.existsSync(BRIDGE_INFO_PATH))
            return null;
        return JSON.parse(fs.readFileSync(BRIDGE_INFO_PATH, 'utf-8'));
    }
    catch {
        return null;
    }
}
class CopilotBridgeProvider {
    constructor(info) {
        this.baseUrl = `http://127.0.0.1:${info.port}`;
        this.token = info.token;
    }
    static fromBridgeFile() {
        const info = readBridgeInfo();
        if (!info) {
            throw new BridgeConnectionError(`Bridge info not found at ${BRIDGE_INFO_PATH}.\n` +
                `Please open VSCode with the oh-my-copilot-bridge extension installed and active.`);
        }
        return new CopilotBridgeProvider(info);
    }
    authHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }
    async checkHealth() {
        try {
            const resp = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
            return resp.ok;
        }
        catch {
            return false;
        }
    }
    async listModels() {
        const resp = await fetch(`${this.baseUrl}/v1/models`, {
            headers: this.authHeaders(),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new BridgeConnectionError(`Failed to list models (${resp.status}): ${text}`);
        }
        const data = await resp.json();
        return data.data;
    }
    async *streamChat(messages, options = {}) {
        const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
                model: options.model ?? 'gpt-4o',
                messages,
                stream: true,
                temperature: options.temperature,
                max_tokens: options.maxTokens,
            }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new BridgeConnectionError(`Chat request failed (${resp.status}): ${text}`);
        }
        if (!resp.body) {
            throw new BridgeConnectionError('No response body from bridge');
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === ':')
                    continue;
                if (trimmed === 'data: [DONE]') {
                    yield { content: '', done: true };
                    return;
                }
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const content = json.choices?.[0]?.delta?.content ?? '';
                        if (content) {
                            yield { content, done: false };
                        }
                    }
                    catch {
                        // skip malformed SSE lines
                    }
                }
            }
        }
    }
    async completeChat(messages, options = {}) {
        let result = '';
        for await (const chunk of this.streamChat(messages, { ...options, stream: true })) {
            result += chunk.content;
        }
        return result;
    }
}
exports.CopilotBridgeProvider = CopilotBridgeProvider;
