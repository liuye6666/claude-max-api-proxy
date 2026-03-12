/**
 * Converts OpenAI chat request format to Claude CLI input
 *
 * Session strategy:
 *  - The OpenAI API passes a `conversation_id` (stored in `request.user`)
 *    to identify the same ongoing conversation across multiple HTTP requests.
 *  - On the first turn for a conversation we assign a fresh UUID as the
 *    Claude session ID and pass `--session-id <id>` to the CLI so it saves
 *    the session to disk.
 *  - On subsequent turns we retrieve the saved Claude session ID and pass
 *    `--resume <id>` so the CLI loads the full context from disk and we only
 *    need to supply the latest user message.
 *
 * Image strategy:
 *  - Plain text → prompt string passed as a CLI positional argument.
 *  - Contains images → structured content blocks written to stdin in
 *    stream-json format (`--input-format stream-json`).
 */
import type { OpenAIChatRequest } from "../types/openai.js";
import type { ClaudeInputContentBlock } from "../types/claude-cli.js";
export type ClaudeModel = "opus" | "sonnet" | "haiku";
export interface CliInput {
    /** Flat text prompt — latest user turn only (plain-text path, no images) */
    prompt?: string;
    /**
     * Structured content blocks for the latest user turn.
     * Used when the turn contains images (stdin stream-json path).
     */
    contentBlocks?: ClaudeInputContentBlock[];
    /** Whether contentBlocks contains at least one image block */
    hasImages: boolean;
    model: ClaudeModel;
    /** External conversation ID supplied by the client (e.g. OpenClaw session) */
    conversationId?: string;
    /**
     * True if this is the very first turn of the conversation.
     * routes.ts uses this to decide between --session-id (new) vs --resume.
     */
    isFirstTurn: boolean;
    /**
     * Claude CLI session UUID (newSessionId or resumeSessionId).
     * routes.ts resolves this via sessionManager before calling subprocess.start.
     */
    claudeSessionId?: string;
}
/** Extract Claude model alias from request model string */
export declare function extractModel(model: string): ClaudeModel;
/**
 * Build a plain text prompt from the FULL message history.
 * Used when there is no prior Claude session (first turn, no session tracking).
 * All roles are included so Claude has full context on a cold start.
 */
export declare function messagesToFullPrompt(messages: OpenAIChatRequest["messages"]): string;
/**
 * Extract only the latest user message as a plain text prompt.
 * Used when resuming an existing Claude session (context already on disk).
 */
export declare function latestUserPrompt(messages: OpenAIChatRequest["messages"]): string;
/**
 * Build content blocks for the FULL message history (first turn with images).
 */
export declare function messagesToBlocks(messages: OpenAIChatRequest["messages"]): ClaudeInputContentBlock[];
/**
 * Convert OpenAI chat request to CLI input format.
 *
 * The returned `CliInput` does NOT include the resolved Claude session UUID;
 * that is filled in by `routes.ts` after consulting `sessionManager` so that
 * this adapter stays pure / testable.
 */
export declare function openaiToCli(request: OpenAIChatRequest): CliInput;
/**
 * Re-derive the prompt/blocks for a session-resume request (subsequent turns).
 * Only the latest user message is sent; Claude CLI loads prior context from disk.
 */
export declare function openaiToCliResume(request: OpenAIChatRequest): CliInput;
//# sourceMappingURL=openai-to-cli.d.ts.map