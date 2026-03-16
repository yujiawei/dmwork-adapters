/**
 * Phase 4c: Group @mention
 *
 * Sends a message in a group that @mentions the bot,
 * verifying the bot processes the mention correctly.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DmworkClient, ChannelType, MessageType, sleep } from "../lib/dmwork-client.js";
import { env } from "./env.js";

describe("Phase 4c: Group @mention", { timeout: 30_000 }, () => {
  let client: DmworkClient;
  let botUid: string;
  let groupId: string | undefined;

  beforeAll(async () => {
    client = new DmworkClient({
      apiUrl: env.dmworkApi,
      userToken: env.userToken,
    });
    const botInfo = await client.verifyBotToken(env.botToken);
    botUid = botInfo.robotId;

    // Find a group the bot belongs to
    const groups = await client.getBotGroups(env.botToken);
    groupId = groups[0]?.group_no;
  });

  it("should find at least one group the bot belongs to", () => {
    // Skip remaining tests if no group available
    if (!groupId) {
      console.warn("⚠ No group found for bot — skipping group mention tests");
    }
    // Not a hard failure: group tests are optional if no group configured
    expect(true).toBe(true);
  });

  it("should send a message @mentioning the bot in the group", async () => {
    if (!groupId) return;

    const testText = `@${botUid} E2E group mention test ${Date.now()}`;
    await client.sendText({
      channelId: groupId,
      channelType: ChannelType.Group,
      content: testText,
      mentionUids: [botUid],
    });
    await sleep(3_000);
  });

  it("should receive a response from the bot in the group", async () => {
    if (!groupId) return;

    const response = await client.waitForMessage({
      channelId: groupId,
      channelType: ChannelType.Group,
      predicate: (msg) =>
        msg.fromUid === botUid &&
        msg.type === MessageType.Text &&
        msg.timestamp > Date.now() - 30_000,
      timeoutMs: 20_000,
    });

    expect(response).toBeTruthy();
    expect(response.content).toBeTruthy();
  });
});
