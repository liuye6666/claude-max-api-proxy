/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 *
 * Two input modes:
 *  1. Plain text (no images): prompt passed as a CLI argument  --  fast path
 *  2. Multimodal  (images):   structured message written to stdin in
 *     stream-json format (`--input-format stream-json`)
 */
import { EventEmitter } from "events";
import type { ClaudeCliMessage, ClaudeCliAssistant, ClaudeCliResult, ClaudeInputContentBlock } from "../types/claude-cli.js";
import type { ClaudeModel } from "../adapter/openai-to-cli.js";
export interface SubprocessOptions {
    model: ClaudeModel;
    sessionId?: string;
    cwd?: string;
    timeout?: number;
    /** When true, the caller must provide contentBlocks instead of a prompt string */
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
     *
     * Claude Code CLI expects a newline-delimited JSON object on stdin
     * when `--input-format stream-json` is active:
     *   { "type": "user", "message": { "role": "user", "content": [...] } }
     */
    private buildStdinMessage;
    /**
     * Build CLI arguments array.
     *
     * When prompt is undefined we are in multimodal stdin mode:
     *   - add `--input-format stream-json`
     *   - do NOT append a prompt argument
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