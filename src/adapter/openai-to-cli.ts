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

import type { OpenAIChatRequest, OpenAIMessageContent, OpenAIContentPart } from "../types/openai.js";
import type {
  ClaudeInputContentBlock,
  ClaudeInputTextBlock,
  ClaudeInputImageBlock,
} from "../types/claude-cli.js";

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

/** Extract Claude model alias from request model string */
export function extractModel(model: string): ClaudeModel {
  if (MODEL_MAP[model]) return MODEL_MAP[model];
  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) return MODEL_MAP[stripped];
  return "opus";
}

/**
 * Convert a base64 data URI ("data:image/png;base64,ABC...") into
 * { media_type, data } ready for the Claude API.
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
 * Returns null if the part cannot be represented.
 */
function openaiPartToClaudeBlock(
  part: OpenAIContentPart
): ClaudeInputContentBlock | null {
  if (part.type === "text") {
    return { type: "text", text: part.text } satisfies ClaudeInputTextBlock;
  }

  if (part.type === "image_url") {
    const { url } = part.image_url;

    const parsed = parseBase64Image(url);
    if (parsed) {
      return {
        type: "image",
        source: { type: "base64", ...parsed },
      } satisfies ClaudeInputImageBlock;
    }

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
 * Extract plain text from OpenAI message content.
 */
function extractText(content: OpenAIMessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Build a plain text prompt from the FULL message history.
 * Used when there is no prior Claude session (first turn, no session tracking).
 * All roles are included so Claude has full context on a cold start.
 */
export function messagesToFullPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const text = extractText(msg.content);
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
 * Extract only the latest user message as a plain text prompt.
 * Used when resuming an existing Claude session (context already on disk).
 */
export function latestUserPrompt(messages: OpenAIChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return extractText(messages[i].content);
    }
  }
  return "";
}

/**
 * Build content blocks for the FULL message history (first turn with images).
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
        const text = extractText(msg.content);
        if (text) {
          preamble.push({ type: "text", text: `<system>\n${text}\n</system>` });
        }
        break;
      }
      case "assistant": {
        const text = extractText(msg.content);
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
 * Extract only the latest user message content blocks (for session-resume with images).
 */
function latestUserBlocks(
  messages: OpenAIChatRequest["messages"]
): ClaudeInputContentBlock[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return contentToBlocks(messages[i].content);
    }
  }
  return [];
}

/**
 * Convert OpenAI chat request to CLI input format.
 *
 * The returned `CliInput` does NOT include the resolved Claude session UUID;
 * that is filled in by `routes.ts` after consulting `sessionManager` so that
 * this adapter stays pure / testable.
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const model = extractModel(request.model);
  // Clients may pass a stable conversation ID in the `user` field.
  const conversationId = request.user;

  const hasImages = request.messages.some((msg) => {
    if (typeof msg.content !== "string") {
      return msg.content.some((p) => p.type === "image_url");
    }
    return false;
  });

  if (hasImages) {
    // For image requests we always include the full history on the first turn;
    // routes.ts will decide whether to use --session-id or --resume based on
    // sessionManager state.
    const contentBlocks = messagesToBlocks(request.messages);
    return {
      contentBlocks,
      hasImages: true,
      model,
      conversationId,
      isFirstTurn: true, // refined by routes.ts
    };
  }

  // Plain text — full prompt assembled here; routes.ts will narrow it to
  // latestUserPrompt if the session already exists.
  return {
    prompt: messagesToFullPrompt(request.messages),
    hasImages: false,
    model,
    conversationId,
    isFirstTurn: true, // refined by routes.ts
  };
}

/**
 * Re-derive the prompt/blocks for a session-resume request (subsequent turns).
 * Only the latest user message is sent; Claude CLI loads prior context from disk.
 */
export function openaiToCliResume(request: OpenAIChatRequest): CliInput {
  const model = extractModel(request.model);
  const conversationId = request.user;

  const hasImages = request.messages.some((msg) => {
    if (typeof msg.content !== "string") {
      return msg.content.some((p) => p.type === "image_url");
    }
    return false;
  });

  if (hasImages) {
    return {
      contentBlocks: latestUserBlocks(request.messages),
      hasImages: true,
      model,
      conversationId,
      isFirstTurn: false,
    };
  }

  return {
    prompt: latestUserPrompt(request.messages),
    hasImages: false,
    model,
    conversationId,
    isFirstTurn: false,
  };
}
