/**
 * Converts OpenAI chat request format to Claude CLI input
 */
import type { OpenAIChatRequest } from "../types/openai.js";
import type { ClaudeInputContentBlock } from "../types/claude-cli.js";
export type ClaudeModel = "opus" | "sonnet" | "haiku";
export interface CliInput {
    /** Flat text prompt (used when there are no images) */
    prompt?: string;
    /**
     * Structured content blocks (used when the request contains images).
     * When set, subprocess/manager passes these via stdin in stream-json format
     * instead of as a CLI argument.
     */
    contentBlocks?: ClaudeInputContentBlock[];
    /** Whether contentBlocks contains at least one image block */
    hasImages: boolean;
    model: ClaudeModel;
    sessionId?: string;
}
/**
 * Extract Claude model alias from request model string
 */
export declare function extractModel(model: string): ClaudeModel;
/**
 * Convert OpenAI messages to a flat text prompt string.
 * Used when the request contains no images (legacy path, avoids stdin overhead).
 */
export declare function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string;
/**
 * Convert OpenAI messages to a flat list of Claude content blocks.
 * Used when the request contains images (stdin stream-json path).
 *
 * System and assistant messages are prepended as text blocks so context
 * is preserved, then all user blocks follow.
 */
export declare function messagesToBlocks(messages: OpenAIChatRequest["messages"]): ClaudeInputContentBlock[];
/**
 * Convert OpenAI chat request to CLI input format.
 *
 * If the request contains images, returns contentBlocks + hasImages=true so
 * the subprocess manager uses the stdin stream-json path.
 * Otherwise returns a plain text prompt for the simple CLI argument path.
 */
export declare function openaiToCli(request: OpenAIChatRequest): CliInput;
//# sourceMappingURL=openai-to-cli.d.ts.map