/**
 * E2E test assertion utilities.
 *
 * Provides higher-level assertion helpers on top of vitest's expect(),
 * tailored for DMWork message verification.
 */

import { expect } from "vitest";
import type { ReceivedMessage } from "./dmwork-client.js";
import { MessageType } from "./dmwork-client.js";

// ─── Message content assertions ──────────────────────────────────────────────

/** Assert that a message contains expected text (substring match). */
export function assertMessageContains(msg: ReceivedMessage, text: string): void {
  expect(msg.content).toContain(text);
}

/** Assert that a message is a text message with exact content. */
export function assertTextMessage(msg: ReceivedMessage, expectedContent: string): void {
  expect(msg.type).toBe(MessageType.Text);
  expect(msg.content).toBe(expectedContent);
}

// ─── Media assertions ────────────────────────────────────────────────────────

/** Assert that a message is an image. */
export function assertImageMessage(msg: ReceivedMessage): void {
  expect(msg.type).toBe(MessageType.Image);
  expect(msg.url).toBeTruthy();
}

/** Assert that a message is a file attachment. */
export function assertFileMessage(msg: ReceivedMessage, expectedName?: string): void {
  expect(msg.type).toBe(MessageType.File);
  expect(msg.url).toBeTruthy();
  if (expectedName) {
    expect(msg.name).toBe(expectedName);
  }
}

/** Assert that a message is a voice message. */
export function assertVoiceMessage(msg: ReceivedMessage): void {
  expect(msg.type).toBe(MessageType.Voice);
  expect(msg.url).toBeTruthy();
}

/** Assert that a media URL is accessible (returns 200). */
export async function assertMediaAccessible(url: string): Promise<void> {
  const resp = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  });
  expect(resp.ok).toBe(true);
}

// ─── Mention assertions ──────────────────────────────────────────────────────

/** Assert that a message mentions specific UIDs. */
export function assertMentions(msg: ReceivedMessage, uids: string[]): void {
  expect(msg.mention).toBeTruthy();
  for (const uid of uids) {
    expect(msg.mention!.uids).toContain(uid);
  }
}

/** Assert that a message is a mention-all. */
export function assertMentionAll(msg: ReceivedMessage): void {
  expect(msg.mention).toBeTruthy();
  const all = msg.mention!.all;
  expect(all === true || all === 1).toBe(true);
}

// ─── Reply assertions ────────────────────────────────────────────────────────

/** Assert that a message is a reply to another message. */
export function assertIsReply(msg: ReceivedMessage): void {
  expect(msg.reply).toBeTruthy();
}

/** Assert reply references a specific sender. */
export function assertReplyFrom(msg: ReceivedMessage, fromUid: string): void {
  expect(msg.reply).toBeTruthy();
  expect(msg.reply!.fromUid).toBe(fromUid);
}

// ─── Timing assertions ──────────────────────────────────────────────────────

/** Assert that a response arrived within a time limit (ms). */
export function assertResponseTime(sentAt: number, receivedAt: number, maxMs: number): void {
  const elapsed = receivedAt - sentAt;
  expect(elapsed).toBeLessThan(maxMs);
}

// ─── Generic polling helper ──────────────────────────────────────────────────

/**
 * Retry a check function until it passes or times out.
 * Useful for waiting for async side effects.
 */
export async function waitUntil(
  check: () => Promise<boolean> | boolean,
  opts?: { timeoutMs?: number; intervalMs?: number; label?: string },
): Promise<void> {
  const timeout = opts?.timeoutMs ?? 15_000;
  const interval = opts?.intervalMs ?? 1_000;
  const label = opts?.label ?? "condition";
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitUntil timed out (${timeout}ms): ${label}`);
}
