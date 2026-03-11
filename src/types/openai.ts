/**
 * Types for OpenAI-compatible API
 * Used for Clawdbot integration
 */

/** Text content part in a multimodal message */
export interface OpenAITextPart {
  type: "text";
  text: string;
}

/** URL-referenced image content part */
export interface OpenAIImageUrlPart {
  type: "image_url";
  image_url: {
    url: string; // "https://..." or "data:image/...;base64,..."
    detail?: "auto" | "low" | "high";
  };
}

/** Content part union */
export type OpenAIContentPart = OpenAITextPart | OpenAIImageUrlPart;

/** Message content: either a plain string or an array of content parts */
export type OpenAIMessageContent = string | OpenAIContentPart[];

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: OpenAIMessageContent;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  user?: string; // Used for session mapping
}

export interface OpenAIChatResponseChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatResponseChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatChunkDelta {
  role?: "assistant";
  content?: string;
}

export interface OpenAIChatChunkChoice {
  index: number;
  delta: OpenAIChatChunkDelta;
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIChatChunkChoice[];
}

export interface OpenAIModel {
  id: string;
  object: "model";
  owned_by: string;
  created?: number;
}

export interface OpenAIModelList {
  object: "list";
  data: OpenAIModel[];
}

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
}
