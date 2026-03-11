/**
 * Types for Claude Code CLI JSON streaming output and input
 * Based on research from PROTOCOL.md
 */
/** Returns true when the message array contains at least one image block */
export function hasImageContent(blocks) {
    return blocks.some((b) => b.type === "image");
}
export function isAssistantMessage(msg) {
    return msg.type === "assistant";
}
export function isResultMessage(msg) {
    return msg.type === "result";
}
export function isStreamEvent(msg) {
    return msg.type === "stream_event";
}
export function isContentDelta(msg) {
    return isStreamEvent(msg) && msg.event.type === "content_block_delta";
}
export function isSystemInit(msg) {
    return msg.type === "system" && msg.subtype === "init";
}
//# sourceMappingURL=claude-cli.js.map