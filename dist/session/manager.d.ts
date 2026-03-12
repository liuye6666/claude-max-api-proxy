/**
 * Session Manager
 *
 * Maps client conversation IDs to Claude CLI session UUIDs.
 * Provides persistence across server restarts via a JSON file on disk.
 *
 * Session lifecycle:
 *  - First turn: routes.ts calls getOrCreate(conversationId, claudeSessionId)
 *    and passes --session-id <claudeSessionId> to Claude CLI.
 *    Claude CLI saves the session context to disk under that UUID.
 *  - Subsequent turns: routes.ts calls get(conversationId) to retrieve the
 *    saved claudeSessionId, then passes --resume <claudeSessionId> to Claude
 *    CLI which loads the context from disk.
 */
export interface SessionMapping {
    conversationId: string;
    /** UUID passed to `--session-id` on the first turn; used for `--resume` later */
    claudeSessionId: string;
    createdAt: number;
    lastUsedAt: number;
    model: string;
}
declare class SessionManager {
    private sessions;
    private loaded;
    /** Load sessions from disk (idempotent) */
    load(): Promise<void>;
    /** Persist sessions to disk */
    save(): Promise<void>;
    /**
     * Create a new session mapping.
     * Call this on the first turn after generating a fresh claudeSessionId UUID.
     */
    getOrCreate(conversationId: string, claudeSessionId: string, model?: string): SessionMapping;
    /** Retrieve an existing session mapping */
    get(conversationId: string): SessionMapping | undefined;
    /** Remove a session (e.g. after an error or explicit reset) */
    delete(conversationId: string): boolean;
    /** Remove sessions older than SESSION_TTL_MS */
    cleanup(): number;
    getAll(): SessionMapping[];
    get size(): number;
}
export declare const sessionManager: SessionManager;
export {};
//# sourceMappingURL=manager.d.ts.map