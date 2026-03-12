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
import { v4 as uuidv4 } from "uuid";
import { ClaudeSubprocess } from "../subprocess/manager.js";
import { openaiToCli, openaiToCliResume } from "../adapter/openai-to-cli.js";
import { cliResultToOpenai, createDoneChunk, } from "../adapter/cli-to-openai.js";
import { sessionManager } from "../session/manager.js";
/**
 * Handle POST /v1/chat/completions
 */
export async function handleChatCompletions(req, res) {
    const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
    const body = req.body;
    const stream = body.stream === true;
    try {
        if (!body.messages ||
            !Array.isArray(body.messages) ||
            body.messages.length === 0) {
            res.status(400).json({
                error: {
                    message: "messages is required and must be a non-empty array",
                    type: "invalid_request_error",
                    code: "invalid_messages",
                },
            });
            return;
        }
        // ------------------------------------------------------------------
        // Resolve session: decide first-turn vs resume
        // ------------------------------------------------------------------
        const conversationId = body.user;
        let isFirstTurn = true;
        let newSessionId;
        let resumeSessionId;
        if (conversationId) {
            await sessionManager.load(); // idempotent — no-op after first call
            const existing = sessionManager.get(conversationId);
            if (existing) {
                // Subsequent turn: resume existing Claude session
                isFirstTurn = false;
                resumeSessionId = existing.claudeSessionId;
                console.log(`[Routes] Resuming session for conversation ${conversationId} → ${resumeSessionId}`);
            }
            else {
                // First turn: create a new named Claude session
                newSessionId = uuidv4();
                sessionManager.getOrCreate(conversationId, newSessionId);
                console.log(`[Routes] New session for conversation ${conversationId} → ${newSessionId}`);
            }
        }
        else {
            // No conversation ID supplied: stateless single-turn (no session flags)
            console.log("[Routes] No conversationId; running stateless single-turn");
        }
        // ------------------------------------------------------------------
        // Build CLI input for the correct turn type
        // ------------------------------------------------------------------
        const cliInput = isFirstTurn
            ? openaiToCli(body)
            : openaiToCliResume(body);
        const subprocess = new ClaudeSubprocess();
        // Attach the resolved session IDs
        const subprocessOptions = {
            model: cliInput.model,
            newSessionId,
            resumeSessionId,
            useStdinInput: cliInput.hasImages,
            contentBlocks: cliInput.contentBlocks,
        };
        if (stream) {
            await handleStreamingResponse(req, res, subprocess, cliInput.prompt, subprocessOptions, requestId);
        }
        else {
            await handleNonStreamingResponse(res, subprocess, cliInput.prompt, subprocessOptions, requestId);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[handleChatCompletions] Error:", message);
        if (!res.headersSent) {
            res.status(500).json({
                error: { message, type: "server_error", code: null },
            });
        }
    }
}
/**
 * Handle streaming response (SSE)
 */
async function handleStreamingResponse(req, res, subprocess, prompt, options, requestId) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Request-Id", requestId);
    res.flushHeaders();
    res.write(":ok\n\n");
    return new Promise((resolve, reject) => {
        let isFirst = true;
        let lastModel = "claude-sonnet-4";
        let isComplete = false;
        res.on("close", () => {
            if (!isComplete)
                subprocess.kill();
            resolve();
        });
        subprocess.on("content_delta", (event) => {
            const text = event.event.delta?.text || "";
            if (text && !res.writableEnded) {
                const chunk = {
                    id: `chatcmpl-${requestId}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: lastModel,
                    choices: [
                        {
                            index: 0,
                            delta: {
                                role: isFirst ? "assistant" : undefined,
                                content: text,
                            },
                            finish_reason: null,
                        },
                    ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                isFirst = false;
            }
        });
        subprocess.on("assistant", (message) => {
            lastModel = message.message.model;
        });
        subprocess.on("result", (_result) => {
            isComplete = true;
            if (!res.writableEnded) {
                const doneChunk = createDoneChunk(requestId, lastModel);
                res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
                res.write("data: [DONE]\n\n");
                res.end();
            }
            resolve();
        });
        subprocess.on("error", (error) => {
            console.error("[Streaming] Error:", error.message);
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({
                    error: { message: error.message, type: "server_error", code: null },
                })}\n\n`);
                res.end();
            }
            resolve();
        });
        subprocess.on("close", (code) => {
            if (!res.writableEnded) {
                if (code !== 0 && !isComplete) {
                    res.write(`data: ${JSON.stringify({
                        error: {
                            message: `Process exited with code ${code}`,
                            type: "server_error",
                            code: null,
                        },
                    })}\n\n`);
                }
                res.write("data: [DONE]\n\n");
                res.end();
            }
            resolve();
        });
        subprocess
            .start(prompt, options)
            .catch((err) => {
            console.error("[Streaming] Subprocess start error:", err);
            reject(err);
        });
    });
}
/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(res, subprocess, prompt, options, requestId) {
    return new Promise((resolve) => {
        let finalResult = null;
        subprocess.on("result", (result) => {
            finalResult = result;
        });
        subprocess.on("error", (error) => {
            console.error("[NonStreaming] Error:", error.message);
            res.status(500).json({
                error: { message: error.message, type: "server_error", code: null },
            });
            resolve();
        });
        subprocess.on("close", (code) => {
            if (finalResult) {
                res.json(cliResultToOpenai(finalResult, requestId));
            }
            else if (!res.headersSent) {
                res.status(500).json({
                    error: {
                        message: `Claude CLI exited with code ${code} without response`,
                        type: "server_error",
                        code: null,
                    },
                });
            }
            resolve();
        });
        subprocess
            .start(prompt, options)
            .catch((error) => {
            res.status(500).json({
                error: { message: error.message, type: "server_error", code: null },
            });
            resolve();
        });
    });
}
/** Handle GET /v1/models */
export function handleModels(_req, res) {
    res.json({
        object: "list",
        data: [
            {
                id: "claude-opus-4",
                object: "model",
                owned_by: "anthropic",
                created: Math.floor(Date.now() / 1000),
            },
            {
                id: "claude-sonnet-4",
                object: "model",
                owned_by: "anthropic",
                created: Math.floor(Date.now() / 1000),
            },
            {
                id: "claude-haiku-4",
                object: "model",
                owned_by: "anthropic",
                created: Math.floor(Date.now() / 1000),
            },
        ],
    });
}
/** Handle GET /health */
export function handleHealth(_req, res) {
    res.json({
        status: "ok",
        provider: "claude-code-cli",
        timestamp: new Date().toISOString(),
    });
}
//# sourceMappingURL=routes.js.map