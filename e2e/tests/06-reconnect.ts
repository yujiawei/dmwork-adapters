/**
 * Test 6: Reconnect
 *
 * Verifies that the WuKongIM WebSocket client reconnects automatically
 * after a connection drop and can still receive messages.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  BotClient, ChannelType, MessageType, sleep,
  resolveWukongimApi, sendViaWukongim,
} from "../lib/dmwork-client.js";
import { WuKongIMClient, type WKMessage } from "../lib/wukongim-client.js";
import { waitUntil } from "../lib/assertions.js";
import { env } from "./env.js";

describe("Reconnect", { timeout: 45_000 }, () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);
  let botReg: Awaited<ReturnType<BotClient["register"]>>;
  let botWs: WuKongIMClient;
  let wukongimApi: string;
  const received: WKMessage[] = [];

  beforeAll(async () => {
    botReg = await bot.register();
    wukongimApi = await resolveWukongimApi(env.wukongimApi);
  });

  afterAll(() => {
    botWs?.disconnect();
  });

  it("should establish initial WuKongIM connection", async () => {
    botWs = new WuKongIMClient(env.wukongimWs, botReg.robotId, botReg.imToken, true);
    botWs.on("message", (msg: WKMessage) => received.push(msg));
    await botWs.connect();
    expect(botWs.isConnected()).toBe(true);
  });

  it("should detect disconnection after force-close", async () => {
    let disconnected = false;
    botWs.once("disconnected", () => { disconnected = true; });

    // Simulate network failure
    botWs.forceClose();

    await waitUntil(() => disconnected, {
      timeoutMs: 5_000,
      label: "disconnection detected",
    });
    expect(botWs.isConnected()).toBe(false);
  });

  it("should auto-reconnect within 10 seconds", async () => {
    await waitUntil(() => botWs.isConnected(), {
      timeoutMs: 10_000,
      intervalMs: 500,
      label: "auto-reconnect",
    });
    expect(botWs.isConnected()).toBe(true);
  });

  it("should receive messages after reconnect", async () => {
    const testText = `E2E reconnect test ${Date.now()}`;
    received.length = 0;

    // Inject message via WuKongIM API
    await sendViaWukongim({
      wukongimApi,
      fromUid: env.userUid,
      channelId: botReg.robotId,
      channelType: ChannelType.DM,
      payload: { type: MessageType.Text, content: testText },
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const match = received.find(
        (m) => m.payload.content === testText && m.fromUid === env.userUid,
      );
      if (match) {
        expect(match.payload.type).toBe(MessageType.Text);
        return;
      }
      await sleep(500);
    }
    throw new Error("Bot did not receive message after reconnect within 10s");
  });
});
