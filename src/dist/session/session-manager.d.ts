import type { ChatMessage } from '../provider/types';
export interface SessionMeta {
    id: string;
    createdAt: string;
    updatedAt: string;
    agent: string;
    model: string;
    cwd: string;
    messageCount: number;
    title?: string;
}
export interface Session {
    meta: SessionMeta;
    messages: ChatMessage[];
}
export declare class SessionManager {
    private sessionDir;
    constructor(sessionDir?: string);
    private ensureDir;
    private sessionPath;
    createSession(agent: string, model: string, cwd: string): Session;
    save(session: Session): void;
    load(id: string): Session | null;
    listSessions(): SessionMeta[];
    deleteSession(id: string): boolean;
    addMessage(session: Session, message: ChatMessage): void;
    getLastSession(): Session | null;
    generateTitle(messages: ChatMessage[]): string;
}
