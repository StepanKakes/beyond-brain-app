/**
 * Beyond Brain chat — what the composer accepts as an attachment.
 *
 * Images ride along as data URLs the SDK writes to a temp file; anything
 * text-like is inlined into the prompt verbatim. The size caps keep a stray
 * drop of a log file or a RAW photo from blowing up the turn.
 */

export const TEXT_LIKE_MIME = /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml))/;
export const TEXT_LIKE_EXT = /\.(md|txt|json|ya?ml|csv|tsv|log|html?|css|js|ts|tsx|jsx|py|sh|toml|ini|env|jsonl)$/i;
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
