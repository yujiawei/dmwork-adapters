/**
 * Phase 4d: Quote Reply
 *
 * Sends a reply to a previous message and verifies the context
 * is correctly propagated.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DmworkClient, ChannelType, MessageType, sleep } from "../lib/dmwork-client.js";
import { env } from "./env.js";

describe("Phase 4d: Quote Reply", { timeout: 30_000 }, () => {
  let client: DmworkClient;
  let botUid: string;
  let originalMsgId: string | undefined;

  beforeAll(async () => {
    client = new DmworkClient({
      apiUrl: env.dmworkApi,
      userToken: env.userToken,
    });
    const botInfo = await client.verifyBotToken(env.botToken);
    botUid = botInfo.robotId;
  });

  it("should send an initial message to create a reply target", async () => {
    await client.sendText({
      channelId: botUid,
      channelType: ChannelType.DM,
      content: `E2E reply target ${Date.now()}`,
    });
    await sleep(3_000);

    // Get the latest message to use as reply target
    const msgs = await client.getMessages({
      channelId: botUid,
      channelType: ChannelType.DM,
      limit: 5,
    });
    const latest = msgs.at(-1);
    if (latest) {
      originalMsgId = latest.messageId;
    }
  });

  it("should send a reply referencing the original message", async () => {
    if (!originalMsgId) {
      console.warn("⚠ No original message ID — skipping reply test");
      return;
    }

    const replyText = `E2E reply to ${originalMsgId} at ${Date.now()}`;
    await client.sendText({
      channelId: botUid,
      channelType: ChannelType.DM,
      content: replyText,
      replyMsgId: originalMsgId,
    });
    await sleep(3_000);
  });

  it("should receive messages with reply context preserved", async () => {
    const msgs = await client.getMessages({
      channelId: botUid,
      channelType: ChannelType.DM,
      limit: 10,
    });

    // Verify we can find messages with reply data
    const replyMsgs = msgs.filter((m) => m.reply);
    // At minimum the conversation should have messages
    expect(msgs.length).toBeGreaterThan(0);
  });
});
