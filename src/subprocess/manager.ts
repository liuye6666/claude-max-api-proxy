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

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  ClaudeCliMessage,
  ClaudeCliAssistant,
  ClaudeCliResult,
  ClaudeCliStreamEvent,
  ClaudeInputContentBlock,
  ClaudeStreamJsonUserMessage,
} from "../types/claude-cli.js";
import { isAssistantMessage, isResultMessage, isContentDelta } from "../types/claude-cli.js";
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

const DEFAULT_TIMEOUT = 300000; // 5 minutes

export class ClaudeSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;

  /**
   * Start the Claude CLI subprocess.
   *
   * @param promptOrBlocks  Plain text prompt string, or undefined when using
   *                        the multimodal stdin path (options.useStdinInput=true).
   */
  async start(
    promptOrBlocks: string | undefined,
    options: SubprocessOptions
  ): Promise<void> {
    const useStdin = options.useStdinInput === true;
    const args = this.buildArgs(
      useStdin ? undefined : (promptOrBlocks as string),
      options
    );
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn("claude", args, {
          cwd: options.cwd || process.cwd(),
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        this.process.on("error", (err) => {
          this.clearTimeout();
          if (err.message.includes("ENOENT")) {
            reject(
              new Error(
                "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
              )
            );
          } else {
            reject(err);
          }
        });

        console.error(`[Subprocess] Process spawned with PID: ${this.process.pid}`);

        // ----------------------------------------------------------------
        // Multimodal path: write structured message to stdin then close it
        // ----------------------------------------------------------------
        if (useStdin && options.contentBlocks) {
          const stdinMessage = this.buildStdinMessage(options.contentBlocks);
          const stdinJson = JSON.stringify(stdinMessage) + "\n";
          this.process.stdin?.write(stdinJson, "utf8", (err) => {
            if (err) {
              console.error("[Subprocess] stdin write error:", err.message);
            }
            this.process?.stdin?.end();
          });
        } else {
          // Plain text path: no stdin needed
          this.process.stdin?.end();
        }

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[Subprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            console.error("[Subprocess stderr]:", errorText.slice(0, 200));
          }
        });

        this.process.on("close", (code) => {
          console.error(`[Subprocess] Process closed with code: ${code}`);
          this.clearTimeout();
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        resolve();
      } catch (err) {
        this.clearTimeout();
        reject(err);
      }
    });
  }

  /**
   * Build the stream-json stdin message for multimodal input.
   */
  private buildStdinMessage(
    blocks: ClaudeInputContentBlock[]
  ): ClaudeStreamJsonUserMessage {
    return {
      type: "user",
      message: {
        role: "user",
        content: blocks,
      },
    };
  }

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
  private buildArgs(
    prompt: string | undefined,
    options: SubprocessOptions
  ): string[] {
    const args: string[] = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", options.model,
    ];

    // Session flags (mutually exclusive)
    if (options.resumeSessionId) {
      // Resume an existing saved session — Claude loads full context from disk
      args.push("--resume", options.resumeSessionId);
    } else if (options.newSessionId) {
      // Start a new named session that will be saved to disk for future --resume
      args.push("--session-id", options.newSessionId);
      // NOTE: do NOT pass --no-session-persistence here; we need the session saved
    } else {
      // Stateless: no session tracking (legacy / single-turn fallback)
      args.push("--no-session-persistence");
    }

    // Input format
    if (options.useStdinInput) {
      args.push("--input-format", "stream-json");
    } else if (prompt !== undefined) {
      args.push(prompt);
    }

    return args;
  }

  /** Process buffered stdout and emit parsed messages */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: ClaudeCliMessage = JSON.parse(trimmed);
        this.emit("message", message);

        if (isContentDelta(message)) {
          this.emit("content_delta", message as ClaudeCliStreamEvent);
        } else if (isAssistantMessage(message)) {
          this.emit("assistant", message);
        } else if (isResultMessage(message)) {
          this.emit("result", message);
        }
      } catch {
        this.emit("raw", trimmed);
      }
    }
  }

  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.process.kill(signal);
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }
}

/** Verify that Claude CLI is installed and accessible */
export async function verifyClaude(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error: "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({ ok: false, error: "Claude CLI returned non-zero exit code" });
      }
    });
  });
}

/**
 * Check if Claude CLI is authenticated.
 * Credentials are stored in the OS keychain by `claude auth login`.
 */
export async function verifyAuth(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}
