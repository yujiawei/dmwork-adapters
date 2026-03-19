/**
 * Test 1: Bot Registration
 *
 * Verifies that the bot token is valid and the bot can register with
 * the DMWork server, obtaining WuKongIM credentials.
 */

import { describe, it, expect } from "vitest";
import { BotClient } from "../lib/dmwork-client.js";
import { env } from "./env.js";

describe("Bot Registration", () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);

  it("should register via POST /v1/bot/register", async () => {
    const reg = await bot.register();
    expect(reg.robotId).toBeTruthy();
    expect(reg.imToken).toBeTruthy();
    expect(reg.ownerUid).toBeTruthy();
  });

  it("should return a valid WebSocket URL", async () => {
    const reg = await bot.register();
    expect(reg.wsUrl).toMatch(/^wss?:\/\//);
  });

  it("should support force-refresh registration", async () => {
    const reg = await bot.register(true);
    expect(reg.robotId).toBeTruthy();
    expect(reg.imToken).toBeTruthy();
  });
});
