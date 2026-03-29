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
exports.runDoctor = runDoctor;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const copilot_bridge_1 = require("../../provider/copilot-bridge");
const config_manager_1 = require("../../config/config-manager");
const BRIDGE_INFO_PATH = path.join(os.homedir(), '.oh-my-copilot', 'bridge.json');
function icon(status) {
    if (status === 'ok')
        return '✓';
    if (status === 'warn')
        return '⚠';
    return '✗';
}
function color(status, text) {
    const codes = { ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
    return `${codes[status]}${text}\x1b[0m`;
}
async function checkBridgeFile() {
    const info = (0, copilot_bridge_1.readBridgeInfo)();
    if (!info) {
        return {
            name: 'Bridge config file',
            status: 'error',
            message: `Not found at ${BRIDGE_INFO_PATH}`,
            detail: 'Open VSCode with oh-my-copilot-bridge extension installed. It will auto-create this file.',
        };
    }
    return {
        name: 'Bridge config file',
        status: 'ok',
        message: `Found (port: ${info.port}, models: ${info.models.join(', ') || 'unknown'})`,
    };
}
async function checkBridgeConnection() {
    const info = (0, copilot_bridge_1.readBridgeInfo)();
    if (!info) {
        return { name: 'Bridge connection', status: 'error', message: 'No bridge config — skipping' };
    }
    const provider = new copilot_bridge_1.CopilotBridgeProvider(info);
    const healthy = await provider.checkHealth();
    if (!healthy) {
        return {
            name: 'Bridge connection',
            status: 'error',
            message: `Cannot connect to bridge at 127.0.0.1:${info.port}`,
            detail: 'VSCode may be closed or bridge extension may have stopped. Reopen VSCode.',
        };
    }
    return { name: 'Bridge connection', status: 'ok', message: `Connected to 127.0.0.1:${info.port}` };
}
async function checkModels() {
    const info = (0, copilot_bridge_1.readBridgeInfo)();
    if (!info) {
        return { name: 'Copilot models', status: 'error', message: 'No bridge config — skipping' };
    }
    const provider = new copilot_bridge_1.CopilotBridgeProvider(info);
    try {
        const models = await provider.listModels();
        if (models.length === 0) {
            return {
                name: 'Copilot models',
                status: 'warn',
                message: 'No models available',
                detail: 'Ensure GitHub Copilot subscription is active and signed in.',
            };
        }
        return {
            name: 'Copilot models',
            status: 'ok',
            message: `${models.length} model(s): ${models.map(m => m.family || m.id).join(', ')}`,
        };
    }
    catch (err) {
        return { name: 'Copilot models', status: 'error', message: `Failed: ${err}` };
    }
}
function checkConfig() {
    const config = (0, config_manager_1.loadConfig)();
    const hasConfig = Object.keys(config).length > 0;
    return {
        name: 'oh-my-copilot config',
        status: hasConfig ? 'ok' : 'warn',
        message: hasConfig ? 'Config loaded' : 'No oh-my-copilot.jsonc found (using defaults)',
        detail: hasConfig ? undefined : 'Run `oh-my-copilot install` to create a config file.',
    };
}
function checkNodeVersion() {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major < 18) {
        return {
            name: 'Node.js version',
            status: 'error',
            message: `Node ${version} — requires >= 18`,
        };
    }
    return { name: 'Node.js version', status: 'ok', message: version };
}
async function runDoctor(options = {}) {
    console.log('\n\x1b[1moh-my-copilot doctor\x1b[0m\n');
    const checks = [];
    checks.push(checkNodeVersion());
    checks.push(checkConfig());
    checks.push(await checkBridgeFile());
    checks.push(await checkBridgeConnection());
    checks.push(await checkModels());
    let hasErrors = false;
    let hasWarnings = false;
    for (const check of checks) {
        if (check.status === 'error')
            hasErrors = true;
        if (check.status === 'warn')
            hasWarnings = true;
        const statusIcon = icon(check.status);
        const statusText = color(check.status, `[${statusIcon}]`);
        console.log(`  ${statusText} ${check.name}: ${check.message}`);
        if (options.verbose && check.detail) {
            console.log(`       ${'\x1b[90m'}${check.detail}\x1b[0m`);
        }
        else if (check.status !== 'ok' && check.detail) {
            console.log(`       ${'\x1b[90m'}${check.detail}\x1b[0m`);
        }
    }
    console.log();
    if (hasErrors) {
        console.log(color('error', '  Some checks failed. Fix the issues above to use oh-my-copilot.'));
    }
    else if (hasWarnings) {
        console.log(color('warn', '  Some warnings. oh-my-copilot should work but review the warnings.'));
    }
    else {
        console.log(color('ok', '  All checks passed! oh-my-copilot is ready.'));
    }
    console.log();
}
