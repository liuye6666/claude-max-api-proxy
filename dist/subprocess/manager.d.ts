/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 *
 * Two input modes:
 *  1. Plain text (no images): prompt passed as a CLI argument  —  fast path
 *  2. Multimodal  (images):   structured message written to stdin in
 *     stream-json format (`--input-format stream-json`)
 *
 * Two session modes:
 *  1. New session:    pass `newSessionId` (UUID) → `--session-id <id>`
 *  2. Resume session: pass `resumeSessionId` (UUID) → `--resume <id>`
 */
import { EventEmitter } from "events";
import type { ClaudeCliMessage, ClaudeCliAssistant, ClaudeCliResult, ClaudeInputContentBlock } from "../types/claude-cli.js";
import type { ClaudeModel } from "../adapter/openai-to-cli.js";
export interface SubprocessOptions {
    model: ClaudeModel;
    /**
     * UUID for a brand-new session. Passed as `--session-id <id>`.
     * Mutually exclusive with resumeSessionId.
     */
    newSessionId?: string;
    /**
     * UUID of an existing session to resume. Passed as `--resume <id>`.
     * Mutually exclusive with newSessionId.
     */
    resumeSessionId?: string;
    cwd?: string;
    timeout?: number;
    /** When true, content is sent via stdin in stream-json format (multimodal path) */
    useStdinInput?: boolean;
    /** Structured content blocks written to stdin (multimodal path) */
    contentBlocks?: ClaudeInputContentBlock[];
}
export interface SubprocessEvents {
    message: (msg: ClaudeCliMessage) => void;
    assistant: (msg: ClaudeCliAssistant) => void;
    result: (result: ClaudeCliResult) => void;
    error: (error: Error) => void;
    close: (code: number | null) => void;
    raw: (line: string) => void;
}
export declare class ClaudeSubprocess extends EventEmitter {
    private process;
    private buffer;
    private timeoutId;
    private isKilled;
    /**
     * Start the Claude CLI subprocess.
     *
     * @param promptOrBlocks  Plain text prompt string, or undefined when using
     *                        the multimodal stdin path (options.useStdinInput=true).
     */
    start(promptOrBlocks: string | undefined, options: SubprocessOptions): Promise<void>;
    /**
     * Build the stream-json stdin message for multimodal input.
     */
    private buildStdinMessage;
    /**
     * Build CLI arguments array.
     *
     * Session behaviour:
     *  - newSessionId   → --session-id <id>   (first turn; session saved to disk)
     *  - resumeSessionId → --resume <id>      (subsequent turns; loads saved session)
     *  - neither        → no session flags    (stateless single-turn)
     *
     * Input behaviour:
     *  - useStdinInput  → --input-format stream-json  (multimodal; no prompt arg)
     *  - plain text     → prompt appended as positional arg
     */
    private buildArgs;
    /** Process buffered stdout and emit parsed messages */
    private processBuffer;
    private clearTimeout;
    kill(signal?: NodeJS.Signals): void;
    isRunning(): boolean;
}
/** Verify that Claude CLI is installed and accessible */
export declare function verifyClaude(): Promise<{
    ok: boolean;
    error?: string;
    version?: string;
}>;
/**
 * Check if Claude CLI is authenticated.
 * Credentials are stored in the OS keychain by `claude auth login`.
 */
export declare function verifyAuth(): Promise<{
    ok: boolean;
    error?: string;
}>;
//# sourceMappingURL=manager.d.ts.map