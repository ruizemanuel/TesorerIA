/** The chat's caps per message (spec, 8.2): the browser and the server read them from here. */
export const MAX_MESSAGE_CHARS = 500;
/** The history sent to the model: its last messages, and at most this many characters of them. */
export const MAX_HISTORY_MESSAGES = 10;
export const MAX_HISTORY_CHARS = 8_000;
/** A request body above this is refused before it's read: ten messages fit in far less. */
export const MAX_CHAT_BODY_BYTES = 200_000;
/** The answer's tokens (thinking included) and the model's steps in one message. */
export const CHAT_MAX_OUTPUT_TOKENS = 1_000;
export const CHAT_MAX_STEPS = 4;
