/**
 * Test 2: Text Messaging
 *
 * Full round-trip: user sends text → bot receives via WuKongIM →
 * bot replies via REST API → verify reply appears in channel sync.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  BotClient, ChannelType, MessageType, sleep,
  resolveWukongimApi, sendViaWukongim, ensureWukongimToken,
} from "../lib/dmwork-client.js";
import { WuKongIMClient, type WKMessage } from "../lib/wukongim-client.js";
import { env } from "./env.js";

describe("Text Messaging", { timeout: 30_000 }, () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);
  let botReg: Awaited<ReturnType<BotClient["register"]>>;
  let botWs: WuKongIMClient;
  let wukongimApi: string;
  const received: WKMessage[] = [];

  beforeAll(async () => {
    botReg = await bot.register();
    wukongimApi = await resolveWukongimApi(env.wukongimApi);

    // Ensure user's WuKongIM token is set
    await ensureWukongimToken({
      wukongimApi,
      uid: env.userUid,
      token: env.userToken,
    });

    // Connect bot to WuKongIM (use local WS, not the external URL from register)
    botWs = new WuKongIMClient(env.wukongimWs, botReg.robotId, botReg.imToken, false);
    botWs.on("message", (msg: WKMessage) => received.push(msg));
    await botWs.connect();
  });

  afterAll(() => {
    botWs?.disconnect();
  });

  it("user sends text → bot receives via WuKongIM", async () => {
    const testText = `E2E text test ${Date.now()}`;
    received.length = 0;

    // Inject message from user to bot via WuKongIM internal API
    await sendViaWukongim({
      wukongimApi,
      fromUid: env.userUid,
      channelId: botReg.robotId,
      channelType: ChannelType.DM,
      payload: { type: MessageType.Text, content: testText },
    });

    // Wait for bot to receive via WuKongIM WS
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const match = received.find(
        (m) => m.payload.content === testText && m.fromUid === env.userUid,
      );
      if (match) {
        expect(match.channelType).toBe(ChannelType.DM);
        expect(match.payload.type).toBe(MessageType.Text);
        return;
      }
      await sleep(500);
    }
    throw new Error("Bot did not receive user message via WuKongIM within 10s");
  });

  it("bot sends text → appears in channel sync", async () => {
    const replyText = `E2E bot reply ${Date.now()}`;

    // Bot sends text via REST API to its owner (the only user it can DM)
    await bot.sendText({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      content: replyText,
    });

    // Verify via sync API
    const msg = await bot.waitForMessage({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      predicate: (m) => m.content === replyText && m.fromUid === botReg.robotId,
      timeoutMs: 10_000,
    });
    expect(msg.type).toBe(MessageType.Text);
    expect(msg.content).toBe(replyText);
  });
});
