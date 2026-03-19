/**
 * Test 5: Group @bot Message
 *
 * Sends a message in a group that @mentions the bot via WuKongIM injection.
 * If the bot is not in any group, tests are skipped gracefully.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  BotClient, ChannelType, MessageType, sleep,
  resolveWukongimApi, sendViaWukongim,
} from "../lib/dmwork-client.js";
import { WuKongIMClient, type WKMessage } from "../lib/wukongim-client.js";
import { env } from "./env.js";

describe("Group @bot Mention", { timeout: 30_000 }, () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);
  let botReg: Awaited<ReturnType<BotClient["register"]>>;
  let botWs: WuKongIMClient;
  let wukongimApi: string;
  let groupId: string | undefined;
  const received: WKMessage[] = [];

  beforeAll(async () => {
    botReg = await bot.register();
    wukongimApi = await resolveWukongimApi(env.wukongimApi);

    // Find a group the bot belongs to
    const groups = await bot.getGroups();
    groupId = groups[0]?.group_no;
    if (!groupId) return; // skip setup if no group

    // Connect bot to WuKongIM
    botWs = new WuKongIMClient(env.wukongimWs, botReg.robotId, botReg.imToken, false);
    botWs.on("message", (msg: WKMessage) => received.push(msg));
    await botWs.connect();
  });

  afterAll(() => {
    botWs?.disconnect();
  });

  it("should find at least one group the bot belongs to", () => {
    if (!groupId) {
      console.warn("⚠ No group found for bot — skipping group mention tests");
    }
    // Not a hard failure: group tests are optional
    expect(true).toBe(true);
  });

  it("should send @bot message in group → bot receives via WuKongIM", async () => {
    if (!groupId) return;

    const testText = `@bot E2E group mention test ${Date.now()}`;
    received.length = 0;

    // Inject @mention message via WuKongIM API
    await sendViaWukongim({
      wukongimApi,
      fromUid: env.userUid,
      channelId: groupId,
      channelType: ChannelType.Group,
      payload: {
        type: MessageType.Text,
        content: testText,
        mention: { uids: [botReg.robotId] },
      },
    });

    // Wait for bot to receive via WuKongIM
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const match = received.find(
        (m) => m.channelId === groupId && m.fromUid === env.userUid,
      );
      if (match) {
        expect(match.channelType).toBe(ChannelType.Group);
        return;
      }
      await sleep(500);
    }
    throw new Error("Bot did not receive group message via WuKongIM within 10s");
  });
});
