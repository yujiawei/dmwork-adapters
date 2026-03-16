/**
 * Phase 4e: Reconnect
 *
 * Simulates a WebSocket disconnection by restarting the OpenClaw gateway,
 * then verifies the bot automatically reconnects and resumes message handling.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DmworkClient, ChannelType, MessageType, sleep } from "../lib/dmwork-client.js";
import {
  restartGateway,
  verifyWsConnected,
  getContainerLogs,
} from "../lib/openclaw-setup.js";
import { waitUntil } from "../lib/assertions.js";
import { sharedState } from "./shared-state.js";
import { env } from "./env.js";

describe("Phase 4e: Reconnect", { timeout: 60_000 }, () => {
  let client: DmworkClient;
  let botUid: string;

  beforeAll(async () => {
    client = new DmworkClient({
      apiUrl: env.dmworkApi,
      userToken: env.userToken,
    });
    const botInfo = await client.verifyBotToken(env.botToken);
    botUid = botInfo.robotId;
  });

  it("should restart the gateway to simulate disconnection", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();
    await restartGateway(instance!);
  });

  it("should re-establish WebSocket connection after restart", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();

    await waitUntil(
      async () => verifyWsConnected(instance!),
      { timeoutMs: 30_000, label: "WS reconnected" },
    );
  });

  it("should still handle messages after reconnect", async () => {
    const testText = `E2E reconnect test ${Date.now()}`;
    await client.sendText({
      channelId: botUid,
      channelType: ChannelType.DM,
      content: testText,
    });

    const response = await client.waitForMessage({
      channelId: botUid,
      channelType: ChannelType.DM,
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
