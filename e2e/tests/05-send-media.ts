/**
 * Phase 4b: sendMedia — Image / File / Voice
 *
 * Core verification for v0.4.0 sendMedia capability.
 * Tests upload + delivery for each media type.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DmworkClient, ChannelType, MessageType, sleep } from "../lib/dmwork-client.js";
import {
  assertImageMessage,
  assertFileMessage,
  assertVoiceMessage,
  assertMediaAccessible,
} from "../lib/assertions.js";
import { env } from "./env.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

describe("Phase 4b: sendMedia", { timeout: 60_000 }, () => {
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

  // ─── Image ───────────────────────────────────────────────────────────────

  describe("Image", () => {
    let uploadedUrl: string;

    it("should upload a test image", async () => {
      const imgPath = path.join(FIXTURES_DIR, "test-image.png");
      const buf = fs.readFileSync(imgPath);
      const result = await client.uploadFile({
        fileBuffer: buf,
        filename: "test-image.png",
        contentType: "image/png",
      });
      expect(result.url).toBeTruthy();
      uploadedUrl = result.url;
    });

    it("should send an image message", async () => {
      await client.sendMedia({
        channelId: botUid,
        channelType: ChannelType.DM,
        type: MessageType.Image,
        url: uploadedUrl,
        name: "test-image.png",
      });
      await sleep(2_000);
    });

    it("should receive the image in channel messages", async () => {
      const msg = await client.waitForMessage({
        channelId: botUid,
        channelType: ChannelType.DM,
        predicate: (m) => m.type === MessageType.Image && !!m.url,
        timeoutMs: 15_000,
      });
      assertImageMessage(msg);
    });

    it("should have an accessible image URL", async () => {
      const msgs = await client.getMessages({
        channelId: botUid,
        channelType: ChannelType.DM,
      });
      const imgMsg = msgs.find((m) => m.type === MessageType.Image && !!m.url);
      expect(imgMsg).toBeTruthy();
      await assertMediaAccessible(imgMsg!.url!);
    });
  });

  // ─── File ────────────────────────────────────────────────────────────────

  describe("File", () => {
    let uploadedUrl: string;

    it("should upload a test PDF file", async () => {
      const filePath = path.join(FIXTURES_DIR, "test-file.pdf");
      const buf = fs.readFileSync(filePath);
      const result = await client.uploadFile({
        fileBuffer: buf,
        filename: "test-file.pdf",
        contentType: "application/pdf",
      });
      expect(result.url).toBeTruthy();
      uploadedUrl = result.url;
    });

    it("should send a file message", async () => {
      await client.sendMedia({
        channelId: botUid,
        channelType: ChannelType.DM,
        type: MessageType.File,
        url: uploadedUrl,
        name: "test-file.pdf",
        size: fs.statSync(path.join(FIXTURES_DIR, "test-file.pdf")).size,
      });
      await sleep(2_000);
    });

    it("should receive the file in channel messages", async () => {
      const msg = await client.waitForMessage({
        channelId: botUid,
        channelType: ChannelType.DM,
        predicate: (m) => m.type === MessageType.File && !!m.url,
        timeoutMs: 15_000,
      });
      assertFileMessage(msg, "test-file.pdf");
    });
  });

  // ─── Voice ───────────────────────────────────────────────────────────────

  describe("Voice", () => {
    let uploadedUrl: string;

    it("should upload a test voice file", async () => {
      const voicePath = path.join(FIXTURES_DIR, "test-voice.mp3");
      const buf = fs.readFileSync(voicePath);
      const result = await client.uploadFile({
        fileBuffer: buf,
        filename: "test-voice.mp3",
        contentType: "audio/mpeg",
      });
      expect(result.url).toBeTruthy();
      uploadedUrl = result.url;
    });

    it("should send a voice message", async () => {
      await client.sendMedia({
        channelId: botUid,
        channelType: ChannelType.DM,
        type: MessageType.Voice,
        url: uploadedUrl,
        name: "test-voice.mp3",
      });
      await sleep(2_000);
    });

    it("should receive the voice message", async () => {
      const msg = await client.waitForMessage({
        channelId: botUid,
        channelType: ChannelType.DM,
        predicate: (m) => m.type === MessageType.Voice && !!m.url,
        timeoutMs: 15_000,
      });
      assertVoiceMessage(msg);
    });
  });
});
