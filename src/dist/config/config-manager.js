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
exports.loadConfig = loadConfig;
exports.writeConfig = writeConfig;
exports.getGlobalConfigDir = getGlobalConfigDir;
exports.ensureGlobalConfigDir = ensureGlobalConfigDir;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const jsonc_parser_1 = require("jsonc-parser");
const CONFIG_FILENAMES = ['oh-my-copilot.jsonc', 'oh-my-copilot.json', '.oh-my-copilot.json'];
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.oh-my-copilot');
function findConfigFile(startDir) {
    let dir = startDir;
    while (true) {
        for (const name of CONFIG_FILENAMES) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate))
                return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // Check global config
    for (const name of CONFIG_FILENAMES) {
        const candidate = path.join(GLOBAL_CONFIG_DIR, name);
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
function readJsonc(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const errors = [];
    const parsed = (0, jsonc_parser_1.parse)(raw, errors);
    if (errors.length > 0) {
        console.warn(`[config] JSONC parse warnings in ${filePath}`);
    }
    return parsed;
}
function loadConfig(cwd = process.cwd()) {
    const configPath = findConfigFile(cwd);
    if (!configPath)
        return {};
    try {
        return readJsonc(configPath);
    }
    catch (err) {
        console.warn(`[config] Failed to load config at ${configPath}: ${err}`);
        return {};
    }
}
function writeConfig(config, targetDir = process.cwd()) {
    const targetPath = path.join(targetDir, 'oh-my-copilot.jsonc');
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(targetPath, content + '\n', 'utf-8');
    return targetPath;
}
function getGlobalConfigDir() {
    return GLOBAL_CONFIG_DIR;
}
function ensureGlobalConfigDir() {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
        fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    }
}
