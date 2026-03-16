/**
 * E2E test assertion utilities.
 */

import { expect } from "vitest";
import type { ReceivedMessage } from "./dmwork-client.js";
import { MessageType } from "./dmwork-client.js";

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

/** Assert that a media URL is accessible (returns 200). */
export async function assertMediaAccessible(url: string): Promise<void> {
  const resp = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  });
  expect(resp.ok).toBe(true);
}

/** Retry a check function until it passes or times out. */
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
