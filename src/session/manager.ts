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

import fs from "fs/promises";
import path from "path";

export interface SessionMapping {
  conversationId: string;
  /** UUID passed to `--session-id` on the first turn; used for `--resume` later */
  claudeSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  model: string;
}

const SESSION_FILE = path.join(
  process.env.HOME || "/tmp",
  ".claude-max-api-sessions.json"
);

// Session TTL: 24 hours
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

class SessionManager {
  private sessions: Map<string, SessionMapping> = new Map();
  private loaded: boolean = false;

  /** Load sessions from disk (idempotent) */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(SESSION_FILE, "utf-8");
      const parsed = JSON.parse(data) as Record<string, SessionMapping>;
      this.sessions = new Map(Object.entries(parsed));
      this.loaded = true;
      console.log(`[SessionManager] Loaded ${this.sessions.size} sessions`);
    } catch {
      this.sessions = new Map();
      this.loaded = true;
    }
  }

  /** Persist sessions to disk */
  async save(): Promise<void> {
    const data = Object.fromEntries(this.sessions);
    await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
  }

  /**
   * Create a new session mapping.
   * Call this on the first turn after generating a fresh claudeSessionId UUID.
   */
  getOrCreate(conversationId: string, claudeSessionId: string, model = "sonnet"): SessionMapping {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const mapping: SessionMapping = {
      conversationId,
      claudeSessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      model,
    };
    this.sessions.set(conversationId, mapping);
    console.log(`[SessionManager] Created session: ${conversationId} → ${claudeSessionId}`);

    this.save().catch((err) => console.error("[SessionManager] Save error:", err));
    return mapping;
  }

  /** Retrieve an existing session mapping */
  get(conversationId: string): SessionMapping | undefined {
    const mapping = this.sessions.get(conversationId);
    if (mapping) {
      mapping.lastUsedAt = Date.now();
    }
    return mapping;
  }

  /** Remove a session (e.g. after an error or explicit reset) */
  delete(conversationId: string): boolean {
    const deleted = this.sessions.delete(conversationId);
    if (deleted) {
      this.save().catch((err) => console.error("[SessionManager] Save error:", err));
    }
    return deleted;
  }

  /** Remove sessions older than SESSION_TTL_MS */
  cleanup(): number {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.lastUsedAt < cutoff) {
        this.sessions.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[SessionManager] Cleaned up ${removed} expired sessions`);
      this.save().catch((err) => console.error("[SessionManager] Save error:", err));
    }
    return removed;
  }

  getAll(): SessionMapping[] {
    return Array.from(this.sessions.values());
  }

  get size(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new SessionManager();

// Kick off initial load; routes.ts also calls load() explicitly before use
sessionManager.load().catch((err) =>
  console.error("[SessionManager] Initial load error:", err)
);

// Periodic cleanup every hour
setInterval(() => {
  sessionManager.cleanup();
}, 60 * 60 * 1000);
