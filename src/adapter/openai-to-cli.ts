/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest, OpenAIMessageContent, OpenAIContentPart } from "../types/openai.js";
import type {
  ClaudeInputContentBlock,
  ClaudeInputTextBlock,
  ClaudeInputImageBlock,
} from "../types/claude-cli.js";

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

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-4": "haiku",
  // With provider prefix
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  // Aliases
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
};

/**
 * Extract Claude model alias from request model string
 */
export function extractModel(model: string): ClaudeModel {
  if (MODEL_MAP[model]) return MODEL_MAP[model];

  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) return MODEL_MAP[stripped];

  // Default to opus (Claude Max subscription)
  return "opus";
}

/**
 * Convert a base64 data URI ("data:image/png;base64,ABC...") or plain base64
 * string into { media_type, data } ready for the Claude API.
 */
function parseBase64Image(url: string): {
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
} | null {
  const match = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/);
  if (match) {
    return {
      media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: match[2],
    };
  }
  return null;
}

/**
 * Convert a single OpenAI content part to a Claude input content block.
 * Returns null if the part cannot be represented (e.g. unsupported type).
 */
function openaiPartToClaudeBlock(
  part: OpenAIContentPart
): ClaudeInputContentBlock | null {
  if (part.type === "text") {
    return { type: "text", text: part.text } satisfies ClaudeInputTextBlock;
  }

  if (part.type === "image_url") {
    const { url } = part.image_url;

    // Data URI  →  base64 block
    const parsed = parseBase64Image(url);
    if (parsed) {
      return {
        type: "image",
        source: { type: "base64", ...parsed },
      } satisfies ClaudeInputImageBlock;
    }

    // Plain URL  →  url block
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return {
        type: "image",
        source: { type: "url", url },
      } satisfies ClaudeInputImageBlock;
    }
  }

  return null;
}

/**
 * Convert OpenAI message content to an array of Claude input content blocks.
 * - string  → single text block
 * - array   → convert each part, skipping unsupported ones
 */
function contentToBlocks(content: OpenAIMessageContent): ClaudeInputContentBlock[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }

  const blocks: ClaudeInputContentBlock[] = [];
  for (const part of content) {
    const block = openaiPartToClaudeBlock(part);
    if (block) blocks.push(block);
  }
  return blocks;
}

/**
 * Convert OpenAI messages to a flat text prompt string.
 * Used when the request contains no images (legacy path, avoids stdin overhead).
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    // Extract only text for the plain-text path
    const blocks = contentToBlocks(msg.content);
    const text = blocks
      .filter((b): b is ClaudeInputTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    switch (msg.role) {
      case "system":
        parts.push(`<system>\n${text}\n</system>\n`);
        break;
      case "user":
        parts.push(text);
        break;
      case "assistant":
        parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * Convert OpenAI messages to a flat list of Claude content blocks.
 * Used when the request contains images (stdin stream-json path).
 *
 * System and assistant messages are prepended as text blocks so context
 * is preserved, then all user blocks follow.
 */
export function messagesToBlocks(
  messages: OpenAIChatRequest["messages"]
): ClaudeInputContentBlock[] {
  const preamble: ClaudeInputTextBlock[] = [];
  const userBlocks: ClaudeInputContentBlock[] = [];

  for (const msg of messages) {
    const blocks = contentToBlocks(msg.content);

    switch (msg.role) {
      case "system": {
        const text = blocks
          .filter((b): b is ClaudeInputTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) {
          preamble.push({ type: "text", text: `<system>\n${text}\n</system>` });
        }
        break;
      }
      case "assistant": {
        const text = blocks
          .filter((b): b is ClaudeInputTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) {
          preamble.push({
            type: "text",
            text: `<previous_response>\n${text}\n</previous_response>`,
          });
        }
        break;
      }
      case "user":
        userBlocks.push(...blocks);
        break;
    }
  }

  return [...preamble, ...userBlocks];
}

/**
 * Convert OpenAI chat request to CLI input format.
 *
 * If the request contains images, returns contentBlocks + hasImages=true so
 * the subprocess manager uses the stdin stream-json path.
 * Otherwise returns a plain text prompt for the simple CLI argument path.
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const model = extractModel(request.model);
  const sessionId = request.user;

  // Check whether any message contains an image part
  const hasImages = request.messages.some((msg) => {
    if (typeof msg.content !== "string") {
      return msg.content.some((p) => p.type === "image_url");
    }
    return false;
  });

  if (hasImages) {
    const contentBlocks = messagesToBlocks(request.messages);
    return { contentBlocks, hasImages: true, model, sessionId };
  }

  return {
    prompt: messagesToPrompt(request.messages),
    hasImages: false,
    model,
    sessionId,
  };
}
