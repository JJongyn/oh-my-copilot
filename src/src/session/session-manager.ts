import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { ChatMessage } from '../provider/types';

const DEFAULT_SESSION_DIR = path.join(os.homedir(), '.oh-my-copilot', 'sessions');
const MAX_HISTORY = 100;

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  agent: string;
  model: string;
  cwd: string;
  messageCount: number;
  title?: string;
  activeSkills?: string[];
  harnessTeamName?: string;
  /** Tags for categorization / filtering */
  tags?: string[];
  /** Whether this session completed successfully (had <promise>DONE</promise>) */
  completed?: boolean;
}

export interface Session {
  meta: SessionMeta;
  messages: ChatMessage[];
}

export class SessionManager {
  private sessionDir: string;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? DEFAULT_SESSION_DIR;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private sessionPath(id: string): string {
    // Sanitize id to prevent path traversal
    const safe = id.replace(/[^a-f0-9]/gi, '');
    return path.join(this.sessionDir, `${safe}.json`);
  }

  createSession(agent: string, model: string, cwd: string): Session {
    const id = crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const session: Session = {
      meta: {
        id,
        createdAt: now,
        updatedAt: now,
        agent,
        model,
        cwd,
        messageCount: 0,
        completed: false,
        activeSkills: [],
        harnessTeamName: undefined,
      },
      messages: [],
    };
    // NOTE: Do NOT save to disk here — only persist when the first message is added.
    // This prevents empty sessions from accumulating on every TUI launch.
    return session;
  }

  save(session: Session): void {
    session.meta.updatedAt = new Date().toISOString();
    session.meta.messageCount = session.messages.length;
    // Auto-generate title from first user message
    if (!session.meta.title && session.messages.length > 0) {
      session.meta.title = this.generateTitle(session.messages);
    }
    // Keep only last MAX_HISTORY messages
    if (session.messages.length > MAX_HISTORY) {
      session.messages = session.messages.slice(-MAX_HISTORY);
    }
    fs.writeFileSync(this.sessionPath(session.meta.id), JSON.stringify(session, null, 2), 'utf-8');
  }

  load(id: string): Session | null {
    const p = this.sessionPath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as Session;
    } catch {
      return null;
    }
  }

  listSessions(): SessionMeta[] {
    if (!fs.existsSync(this.sessionDir)) return [];
    const files = fs.readdirSync(this.sessionDir).filter(f => f.endsWith('.json'));
    const metas: SessionMeta[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(this.sessionDir, file), 'utf-8'),
        ) as Record<string, unknown>;

        let meta: SessionMeta | undefined;

        if (raw?.meta && typeof raw.meta === 'object') {
          // New format: { meta: { id, createdAt, ... }, messages: [] }
          const m = raw.meta as Record<string, unknown>;
          if (m.id && m.updatedAt) meta = m as unknown as SessionMeta;
        } else if (raw?.id && raw?.updatedAt) {
          // Old format: { id, name, createdAt, updatedAt, messages, ... }
          meta = {
            id: String(raw.id),
            createdAt: String(raw.createdAt ?? raw.updatedAt),
            updatedAt: String(raw.updatedAt),
            agent: String(raw.agent ?? 'sisyphus'),
            model: String(raw.model ?? 'gpt-5-mini'),
            cwd: String(raw.cwd ?? process.cwd()),
            messageCount: Array.isArray(raw.messages) ? raw.messages.length : 0,
            title: raw.name ? String(raw.name) : undefined,
          };
        }

        if (meta) metas.push(meta);
      } catch {
        // skip corrupt files
      }
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Search sessions by title or agent name */
  searchSessions(query: string): SessionMeta[] {
    const q = query.toLowerCase();
    return this.listSessions().filter(s => {
      const title = (s.title ?? '').toLowerCase();
      const agent = s.agent.toLowerCase();
      const cwd = s.cwd.toLowerCase();
      return title.includes(q) || agent.includes(q) || cwd.includes(q);
    });
  }

  /** Get sessions filtered by working directory */
  getSessionsForCwd(cwd: string): SessionMeta[] {
    return this.listSessions().filter(s => s.cwd === cwd);
  }

  deleteSession(id: string): boolean {
    const p = this.sessionPath(id);
    if (!fs.existsSync(p)) return false;
    try {
      fs.unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }

  /** Delete multiple sessions at once */
  deleteSessions(ids: string[]): { deleted: number; failed: number } {
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      if (this.deleteSession(id)) deleted++;
      else failed++;
    }
    return { deleted, failed };
  }

  /** Delete all sessions except the current one */
  deleteAllExcept(keepId?: string): number {
    const sessions = this.listSessions();
    let deleted = 0;
    for (const s of sessions) {
      if (!s || !s.id) continue;
      if (keepId && s.id === keepId) continue;
      if (this.deleteSession(s.id)) deleted++;
    }
    return deleted;
  }

  /** Delete sessions older than N days */
  deleteOlderThan(days: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const sessions = this.listSessions();
    let deleted = 0;
    for (const s of sessions) {
      if (new Date(s.updatedAt) < cutoff) {
        if (this.deleteSession(s.id)) deleted++;
      }
    }
    return deleted;
  }

  addMessage(session: Session, message: ChatMessage): void {
    session.messages.push(message);
    this.save(session);
  }

  /** Mark a session as completed */
  markCompleted(session: Session): void {
    session.meta.completed = true;
    this.save(session);
  }

  getLastSession(): Session | null {
    const metas = this.listSessions();
    if (metas.length === 0) return null;
    return this.load(metas[0].id);
  }

  /** Get last session for a specific working directory */
  getLastSessionForCwd(cwd: string): Session | null {
    const sessions = this.getSessionsForCwd(cwd);
    if (sessions.length === 0) return null;
    return this.load(sessions[0].id);
  }

  generateTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return 'Untitled session';
    // Clean up the title: remove newlines, trim whitespace, truncate
    return firstUser.content
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  /** Export a session as a readable markdown string */
  exportAsMarkdown(session: Session): string {
    const lines: string[] = [
      `# Session: ${session.meta.title ?? session.meta.id}`,
      '',
      `- **Agent**: ${session.meta.agent}`,
      `- **Model**: ${session.meta.model}`,
      `- **Created**: ${session.meta.createdAt}`,
      `- **CWD**: ${session.meta.cwd}`,
      `- **Messages**: ${session.meta.messageCount}`,
      '',
      '---',
      '',
    ];

    for (const msg of session.messages) {
      if (msg.role === 'user') {
        lines.push(`## User\n\n${msg.content}\n`);
      } else if (msg.role === 'assistant') {
        lines.push(`## Assistant\n\n${msg.content}\n`);
      } else {
        lines.push(`## System\n\n${msg.content}\n`);
      }
    }

    return lines.join('\n');
  }

  /** Get total session count and storage size */
  getStats(): { count: number; totalSize: number } {
    if (!fs.existsSync(this.sessionDir)) return { count: 0, totalSize: 0 };
    const files = fs.readdirSync(this.sessionDir).filter(f => f.endsWith('.json'));
    let totalSize = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(this.sessionDir, file));
        totalSize += stat.size;
      } catch { /* skip */ }
    }
    return { count: files.length, totalSize };
  }
}
