/**
 * Shared @mention parsing utilities.
 * Ensures consistent mention detection across inbound and outbound code paths.
 *
 * Fixes: https://github.com/dmwork-org/dmwork-adapters/issues/31
 */

/**
 * Regex pattern for matching @mentions in message content.
 * Supports:
 * - English alphanumeric with underscores: @user_123
 * - Chinese characters: @陈皮皮
 * - Dots and hyphens: @thomas.ford, @user-name
 * - Mixed: @陈皮皮_test
 */
export const MENTION_PATTERN = /@[\w\u4e00-\u9fa5.\-]+/g;

/**
 * Parse @mentions from message content.
 * Returns an array of mentioned names (without the @ prefix).
 *
 * @example
 * parseMentions("Hello @陈皮皮 and @bob_123!")
 * // Returns: ["陈皮皮", "bob_123"]
 */
export function parseMentions(content: string): string[] {
  // Create a new RegExp instance to reset lastIndex for global matching
  const regex = new RegExp(MENTION_PATTERN.source, "g");
  const matches = content.match(regex) ?? [];
  return matches.map((m) => m.slice(1)); // Remove @ prefix
}

/**
 * Extract raw @mention matches including the @ prefix.
 * Useful when you need to know the exact position or full match.
 *
 * @example
 * extractMentionMatches("Hello @陈皮皮!")
 * // Returns: ["@陈皮皮"]
 */
export function extractMentionMatches(content: string): string[] {
  const regex = new RegExp(MENTION_PATTERN.source, "g");
  return content.match(regex) ?? [];
}
