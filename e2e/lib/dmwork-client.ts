/**
 * DMWork API client — simulates the "user side" for E2E testing.
 *
 * Uses DMWork REST API to send messages, upload files, etc. as if a real
 * user were interacting with the bot.
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";

// ─── Types ───────────────────────────────────────────────────────────────────

export enum ChannelType {
  DM = 1,
  Group = 2,
}

export enum MessageType {
  Text = 1,
  Image = 2,
  GIF = 3,
  Voice = 4,
  Video = 5,
  Location = 6,
  Card = 7,
  File = 8,
  MultipleForward = 11,
}

export interface ReceivedMessage {
  messageId: string;
  fromUid: string;
  channelId: string;
  channelType: ChannelType;
  content: string;
  type: MessageType;
  url?: string;
  name?: string;
  timestamp: number;
  mention?: { uids?: string[]; all?: boolean | number };
  reply?: { fromUid?: string; fromName?: string; payload?: unknown };
}

export interface SendMessageResult {
  messageId?: string;
  messageSeq?: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

export class DmworkClient extends EventEmitter {
  readonly apiUrl: string;
  readonly userToken: string;

  constructor(params: { apiUrl: string; userToken: string }) {
    super();
    this.apiUrl = params.apiUrl.replace(/\/+$/, "");
    this.userToken = params.userToken;
  }

  // ─── REST helpers ────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.userToken}`,
    };
    const init: RequestInit = { method, headers };
    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DMWork ${method} ${path} failed (${resp.status}): ${text}`);
    }
    const text = await resp.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ─── Bot registration verification ──────────────────────────────────────

  /** Verify a bot token is valid by calling register. */
  async verifyBotToken(botToken: string): Promise<{
    robotId: string;
    imToken: string;
    wsUrl: string;
    ownerUid: string;
  }> {
    const url = `${this.apiUrl}/v1/bot/register`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({}),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Bot token verification failed (${resp.status}): ${text}`);
    }
    const data = await resp.json() as Record<string, string>;
    return {
      robotId: data.robot_id,
      imToken: data.im_token,
      wsUrl: data.ws_url,
      ownerUid: data.owner_uid,
    };
  }

  // ─── Send text message ──────────────────────────────────────────────────

  async sendText(params: {
    channelId: string;
    channelType: ChannelType;
    content: string;
    mentionUids?: string[];
    mentionAll?: boolean;
    replyMsgId?: string;
  }): Promise<SendMessageResult> {
    const payload: Record<string, unknown> = {
      type: MessageType.Text,
      content: params.content,
    };
    if (params.mentionUids?.length || params.mentionAll) {
      const mention: Record<string, unknown> = {};
      if (params.mentionUids?.length) mention.uids = params.mentionUids;
      if (params.mentionAll) mention.all = true;
      payload.mention = mention;
    }
    if (params.replyMsgId) {
      payload.reply = { message_id: params.replyMsgId };
    }
    return this.request<SendMessageResult>("POST", "/v1/bot/sendMessage", {
      channel_id: params.channelId,
      channel_type: params.channelType,
      payload,
    });
  }

  // ─── Upload file ────────────────────────────────────────────────────────

  async uploadFile(params: {
    fileBuffer: Buffer;
    filename: string;
    contentType: string;
  }): Promise<{ url: string }> {
    const url = `${this.apiUrl}/v1/bot/upload`;
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(params.fileBuffer)], { type: params.contentType });
    formData.append("file", blob, params.filename);

    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.userToken}` },
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Upload failed (${resp.status}): ${text}`);
    }
    const data = await resp.json() as { url?: string };
    if (!data.url) throw new Error("Upload returned no url");
    return { url: data.url };
  }

  // ─── Send media message ─────────────────────────────────────────────────

  async sendMedia(params: {
    channelId: string;
    channelType: ChannelType;
    type: MessageType;
    url: string;
    name?: string;
    size?: number;
  }): Promise<SendMessageResult> {
    const payload: Record<string, unknown> = {
      type: params.type,
      url: params.url,
    };
    if (params.name) payload.name = params.name;
    if (params.size != null) payload.size = params.size;
    return this.request<SendMessageResult>("POST", "/v1/bot/sendMessage", {
      channel_id: params.channelId,
      channel_type: params.channelType,
      payload,
    });
  }

  // ─── Get channel messages (sync) ────────────────────────────────────────

  async getMessages(params: {
    channelId: string;
    channelType: ChannelType;
    limit?: number;
  }): Promise<ReceivedMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>(
      "POST",
      "/v1/bot/messages/sync",
      {
        channel_id: params.channelId,
        channel_type: params.channelType,
        limit: params.limit ?? 20,
        start_message_seq: 0,
        end_message_seq: 0,
        pull_mode: 1,
      },
    );
    const messages = data?.messages ?? [];
    return messages.map((m: any) => {
      let payload: any = {};
      if (m.payload) {
        try {
          payload = JSON.parse(Buffer.from(m.payload, "base64").toString("utf-8"));
        } catch {
          payload = typeof m.payload === "object" ? m.payload : {};
        }
      }
      return {
        messageId: m.message_id ?? "",
        fromUid: m.from_uid ?? "unknown",
        channelId: m.channel_id ?? params.channelId,
        channelType: m.channel_type ?? params.channelType,
        content: payload.content ?? "",
        type: payload.type ?? MessageType.Text,
        url: payload.url,
        name: payload.name,
        timestamp: (m.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
        mention: payload.mention,
        reply: payload.reply,
      } satisfies ReceivedMessage;
    });
  }

  // ─── Get bot groups ─────────────────────────────────────────────────────

  async getBotGroups(botToken: string): Promise<Array<{ group_no: string; name: string }>> {
    const url = `${this.apiUrl}/v1/bot/groups`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!resp.ok) return [];
    return resp.json();
  }

  // ─── Wait for a message matching a predicate ───────────────────────────

  /**
   * Poll messages/sync until a message matching the predicate appears.
   * Returns the first matching message or throws on timeout.
   */
  async waitForMessage(params: {
    channelId: string;
    channelType: ChannelType;
    predicate: (msg: ReceivedMessage) => boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<ReceivedMessage> {
    const timeout = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const interval = params.pollIntervalMs ?? 2_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const msgs = await this.getMessages({
        channelId: params.channelId,
        channelType: params.channelType,
        limit: 50,
      });
      const match = msgs.find(params.predicate);
      if (match) return match;
      await sleep(interval);
    }
    throw new Error(
      `Timed out (${timeout}ms) waiting for message in ${params.channelId}`,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
