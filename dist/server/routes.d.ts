/**
 * API Route Handlers
 *
 * Implements OpenAI-compatible endpoints for Clawdbot integration.
 *
 * Multi-turn session flow:
 *  1. Client sends a request with `user` field as a stable conversation ID.
 *  2. If `sessionManager` has no entry → first turn:
 *       - Generate a new Claude session UUID.
 *       - Pass `--session-id <uuid>` to CLI so it saves the session to disk.
 *       - Store the mapping conversation_id → claude_session_id in sessionManager.
 *       - Send full message history as context.
 *  3. If `sessionManager` already has an entry → subsequent turn:
 *       - Retrieve the saved Claude session UUID.
 *       - Pass `--resume <uuid>` to CLI so it loads context from disk.
 *       - Send only the latest user message (context already on disk).
 */
import type { Request, Response } from "express";
/**
 * Handle POST /v1/chat/completions
 */
export declare function handleChatCompletions(req: Request, res: Response): Promise<void>;
/** Handle GET /v1/models */
export declare function handleModels(_req: Request, res: Response): void;
/** Handle GET /health */
export declare function handleHealth(_req: Request, res: Response): void;
//# sourceMappingURL=routes.d.ts.map