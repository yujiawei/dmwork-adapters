/**
 * Phase 1: Bot Setup
 *
 * Verifies that the bot token is valid and the bot can register with
 * the DMWork server.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DmworkClient } from "../lib/dmwork-client.js";
import { env } from "./env.js";

describe("Phase 1: Bot Setup", () => {
  let client: DmworkClient;

  beforeAll(() => {
    client = new DmworkClient({
      apiUrl: env.dmworkApi,
      userToken: env.userToken,
    });
  });

  it("should have required environment variables set", () => {
    expect(env.botToken).toBeTruthy();
    expect(env.dmworkApi).toBeTruthy();
    expect(env.userToken).toBeTruthy();
  });

  it("should verify bot token is valid via /v1/bot/register", async () => {
    const result = await client.verifyBotToken(env.botToken);
    expect(result.robotId).toBeTruthy();
    expect(result.imToken).toBeTruthy();
    expect(result.wsUrl).toBeTruthy();
    expect(result.ownerUid).toBeTruthy();
  });

  it("should get bot info including websocket URL", async () => {
    const result = await client.verifyBotToken(env.botToken);
    // wsUrl should be a valid websocket URL
    expect(result.wsUrl).toMatch(/^wss?:\/\//);
  });
});
