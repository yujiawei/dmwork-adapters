/**
 * Phase 4a: Text Messaging
 *
 * Sends a text message to the bot's DM channel and verifies the bot
 * receives it and responds.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DmworkClient, ChannelType, MessageType, sleep } from "../lib/dmwork-client.js";
import { assertMessageContains } from "../lib/assertions.js";
import { env } from "./env.js";
import { sharedState } from "./shared-state.js";

describe("Phase 4a: Text Messaging", { timeout: 30_000 }, () => {
  let client: DmworkClient;
  let botUid: string;

  beforeAll(async () => {
    client = new DmworkClient({
      apiUrl: env.dmworkApi,
      userToken: env.userToken,
    });
    // Get bot UID for channel identification
    const botInfo = await client.verifyBotToken(env.botToken);
    botUid = botInfo.robotId;
  });

  it("should send a text message to the bot", async () => {
    const testText = `E2E test message ${Date.now()}`;
    sharedState.lastTestText = testText;

    await client.sendText({
      channelId: botUid,
      channelType: ChannelType.DM,
      content: testText,
    });
    // Allow processing time
    await sleep(3_000);
  });

  it("should receive a response from the bot", async () => {
    const botInfo = await client.verifyBotToken(env.botToken);

    const response = await client.waitForMessage({
      channelId: botInfo.robotId,
      channelType: ChannelType.DM,
      predicate: (msg) =>
        msg.fromUid === botInfo.robotId &&
        msg.type === MessageType.Text &&
        msg.timestamp > Date.now() - 30_000,
      timeoutMs: 20_000,
    });

    expect(response).toBeTruthy();
    expect(response.content).toBeTruthy();
    expect(response.type).toBe(MessageType.Text);
  });
});
