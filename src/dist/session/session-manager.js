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
exports.SessionManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const DEFAULT_SESSION_DIR = path.join(os.homedir(), '.oh-my-copilot', 'sessions');
const MAX_HISTORY = 100;
class SessionManager {
    constructor(sessionDir) {
        this.sessionDir = sessionDir ?? DEFAULT_SESSION_DIR;
        this.ensureDir();
    }
    ensureDir() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }
    sessionPath(id) {
        return path.join(this.sessionDir, `${id}.json`);
    }
    createSession(agent, model, cwd) {
        const id = crypto.randomBytes(8).toString('hex');
        const now = new Date().toISOString();
        const session = {
            meta: {
                id,
                createdAt: now,
                updatedAt: now,
                agent,
                model,
                cwd,
                messageCount: 0,
            },
            messages: [],
        };
        this.save(session);
        return session;
    }
    save(session) {
        session.meta.updatedAt = new Date().toISOString();
        session.meta.messageCount = session.messages.length;
        // Keep only last MAX_HISTORY messages
        if (session.messages.length > MAX_HISTORY) {
            session.messages = session.messages.slice(-MAX_HISTORY);
        }
        fs.writeFileSync(this.sessionPath(session.meta.id), JSON.stringify(session, null, 2), 'utf-8');
    }
    load(id) {
        const p = this.sessionPath(id);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    listSessions() {
        if (!fs.existsSync(this.sessionDir))
            return [];
        const files = fs.readdirSync(this.sessionDir).filter(f => f.endsWith('.json'));
        const metas = [];
        for (const file of files) {
            try {
                const session = JSON.parse(fs.readFileSync(path.join(this.sessionDir, file), 'utf-8'));
                metas.push(session.meta);
            }
            catch {
                // skip corrupt files
            }
        }
        return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    deleteSession(id) {
        const p = this.sessionPath(id);
        if (!fs.existsSync(p))
            return false;
        fs.unlinkSync(p);
        return true;
    }
    addMessage(session, message) {
        session.messages.push(message);
        this.save(session);
    }
    getLastSession() {
        const metas = this.listSessions();
        if (metas.length === 0)
            return null;
        return this.load(metas[0].id);
    }
    generateTitle(messages) {
        const firstUser = messages.find(m => m.role === 'user');
        if (!firstUser)
            return 'Untitled session';
        return firstUser.content.slice(0, 60).replace(/\n/g, ' ');
    }
}
exports.SessionManager = SessionManager;
