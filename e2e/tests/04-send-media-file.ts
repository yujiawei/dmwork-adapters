/**
 * Test 4: sendMedia — File
 *
 * Upload a test PDF file via /v1/file/upload, then send it as a file
 * message (type=8) via bot API and verify delivery.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BotClient, ChannelType, MessageType } from "../lib/dmwork-client.js";
import { assertFileMessage, assertMediaAccessible } from "../lib/assertions.js";
import { env } from "./env.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

describe("sendMedia: File", { timeout: 30_000 }, () => {
  const bot = new BotClient(env.dmworkApi, env.botToken);
  let botReg: Awaited<ReturnType<BotClient["register"]>>;
  let uploadedUrl: string;
  const filePath = path.join(FIXTURES_DIR, "test-file.pdf");

  beforeAll(async () => {
    botReg = await bot.register();
  });

  it("should upload a test PDF file via /v1/file/upload", async () => {
    const buf = fs.readFileSync(filePath);
    uploadedUrl = await bot.upload(buf, "test-file.pdf", "application/pdf", env.userToken);
    expect(uploadedUrl).toBeTruthy();
    expect(typeof uploadedUrl).toBe("string");
  });

  it("should send a file message (type=8) to owner", async () => {
    const size = fs.statSync(filePath).size;
    await bot.sendMedia({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      type: MessageType.File,
      url: uploadedUrl,
      name: "test-file.pdf",
      size,
    });
  });

  it("should appear in channel messages with correct type and name", async () => {
    const msg = await bot.waitForMessage({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
      predicate: (m) =>
        m.type === MessageType.File &&
        !!m.url &&
        m.fromUid === botReg.robotId,
      timeoutMs: 10_000,
    });
    assertFileMessage(msg, "test-file.pdf");
  });

  it("should have an accessible file URL", async () => {
    const msgs = await bot.syncMessages({
      channelId: botReg.ownerUid,
      channelType: ChannelType.DM,
    });
    const fileMsg = msgs.find(
      (m) => m.type === MessageType.File && !!m.url && m.fromUid === botReg.robotId,
    );
    expect(fileMsg).toBeTruthy();
    await assertMediaAccessible(fileMsg!.url!);
  });
});
