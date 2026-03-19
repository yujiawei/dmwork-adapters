/**
 * Test 3: sendMedia — Image
 *
 * Upload a test image via /v1/file/upload, then send it as an image
 * message (type=2) via bot API and verify delivery.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BotClient, ChannelType, MessageType } from "../lib/dmwork-client.js";
import { assertImageMessage, assertMediaAccessible } from "../lib/assertions.js";
import { env } from "./env.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

describe("sendMedia: Image", { timeout: 30_000 }, () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);
  let botReg: Awaited<ReturnType<BotClient["register"]>>;
  let uploadedUrl: string;

  beforeAll(async () => {
    botReg = await bot.register();
  });

  it("should upload a test image via /v1/file/upload", async () => {
    const buf = fs.readFileSync(path.join(FIXTURES_DIR, "test-image.png"));
    uploadedUrl = await bot.upload(buf, "test-image.png", "image/png", env.userToken);
    expect(uploadedUrl).toBeTruthy();
    expect(typeof uploadedUrl).toBe("string");
  });

  it("should send an image message (type=2) to owner", async () => {
    await bot.sendMedia({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      type: MessageType.Image,
      url: uploadedUrl,
      name: "test-image.png",
    });
  });

  it("should appear in channel messages with correct type", async () => {
    const msg = await bot.waitForMessage({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      predicate: (m) =>
        m.type === MessageType.Image &&
        !!m.url &&
        m.fromUid === botReg.robotId,
      timeoutMs: 10_000,
    });
    assertImageMessage(msg);
  });

  it("should have an accessible image URL", async () => {
    const msgs = await bot.syncMessages({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
    });
    const imgMsg = msgs.find(
      (m) => m.type === MessageType.Image && !!m.url && m.fromUid === botReg.robotId,
    );
    expect(imgMsg).toBeTruthy();
    await assertMediaAccessible(imgMsg!.url!);
  });
});
