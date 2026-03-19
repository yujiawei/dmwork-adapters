/**
 * DMWork API client — simulates both "bot side" and "user side" for E2E testing.
 *
 * Bot side: register, send messages, upload files via /v1/bot/* endpoints.
 * User side: upload via /v1/file/upload, message injection via WuKongIM API.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

export interface BotRegistration {
  robotId: string;
  imToken: string;
  wsUrl: string;
  apiUrl: string;
  ownerUid: string;
  ownerChannelId: string;
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

// ─── Bot API Client ─────────────────────────────────────────────────────────

export class BotClient {
  constructor(
    private apiUrl: string,
    private botToken: string,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
  }

  /** Register bot — returns credentials for WuKongIM connection. */
  async register(forceRefresh = false): Promise<BotRegistration> {
    const path = forceRefresh ? "/v1/bot/register?force_refresh=true" : "/v1/bot/register";
    const data = await this.botPost<Record<string, string>>(path, {});
    if (!data) throw new Error("Bot registration returned empty response");
    return {
      robotId: data.robot_id,
      imToken: data.im_token,
      wsUrl: data.ws_url,
      apiUrl: data.api_url ?? this.apiUrl,
      ownerUid: data.owner_uid,
      ownerChannelId: data.owner_channel_id ?? "",
    };
  }

  /** Send a text message as the bot. */
  async sendText(params: {
    channelId: string;
    channelType: ChannelType;
    content: string;
    mentionUids?: string[];
    mentionAll?: boolean;
    replyMsgId?: string;
  }): Promise<void> {
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
    await this.botPost("/v1/bot/sendMessage", {
      channel_id: params.channelId,
      channel_type: params.channelType,
      payload,
    });
  }

  /** Send a media message (image/file) as the bot. */
  async sendMedia(params: {
    channelId: string;
    channelType: ChannelType;
    type: MessageType;
    url: string;
    name?: string;
    size?: number;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      type: params.type,
      url: params.url,
    };
    if (params.name) payload.name = params.name;
    if (params.size != null) payload.size = params.size;
    await this.botPost("/v1/bot/sendMessage", {
      channel_id: params.channelId,
      channel_type: params.channelType,
      payload,
    });
  }

  /**
   * Upload a file via DMWork file upload endpoint.
   * Uses the user token (file upload is a user-facing API).
   */
  async upload(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    userToken: string,
  ): Promise<string> {
    const uniquePath = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = `${this.apiUrl}/v1/file/upload?type=chat&path=${uniquePath}`;
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: contentType });
    formData.append("file", blob, filename);

    const resp = await fetch(url, {
      method: "POST",
      headers: { token: userToken },
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Upload failed (${resp.status}): ${text}`);
    }
    const data = await resp.json() as { path?: string; url?: string };
    const cdnUrl = data.path ?? data.url;
    if (!cdnUrl) throw new Error("Upload returned no path/url");
    return cdnUrl;
  }

  /** Sync messages from a channel. */
  async syncMessages(params: {
    channelId: string;
    channelType: ChannelType;
    limit?: number;
  }): Promise<ReceivedMessage[]> {
    const data = await this.botPost<{ messages?: unknown[] }>("/v1/bot/messages/sync", {
      channel_id: params.channelId,
      channel_type: params.channelType,
      limit: params.limit ?? 20,
      start_message_seq: 0,
      end_message_seq: 0,
      pull_mode: 1,
    });
    return parseMessages(data?.messages ?? [], params.channelId, params.channelType);
  }

  /** Get groups the bot belongs to. */
  async getGroups(): Promise<Array<{ group_no: string; name: string }>> {
    const url = `${this.apiUrl}/v1/bot/groups`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.botToken}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  }

  /** Poll until a matching message appears. */
  async waitForMessage(params: {
    channelId: string;
    channelType: ChannelType;
    predicate: (msg: ReceivedMessage) => boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<ReceivedMessage> {
    const timeout = params.timeoutMs ?? 15_000;
    const interval = params.pollIntervalMs ?? 2_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const msgs = await this.syncMessages({
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

  private async botPost<T>(path: string, body: Record<string, unknown>): Promise<T | undefined> {
    const url = `${this.apiUrl}${path}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DMWork ${path} failed (${resp.status}): ${text}`);
    }
    const text = await resp.text();
    if (!text) return undefined;
    return JSON.parse(text) as T;
  }
}

// ─── WuKongIM Message Injection ─────────────────────────────────────────────

/**
 * Resolve the WuKongIM internal HTTP API URL.
 * If E2E_WUKONGIM_API is set, use that. Otherwise, auto-detect from Docker.
 */
export async function resolveWukongimApi(envValue: string): Promise<string> {
  if (envValue) return envValue;

  // Auto-detect from Docker
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect", "tsdd-wukongim-1",
      "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    ]);
    const ip = stdout.trim();
    if (ip) return `http://${ip}:5001`;
  } catch {
    // Docker not available
  }
  throw new Error(
    "Cannot resolve WuKongIM API. Set E2E_WUKONGIM_API or ensure Docker is accessible.",
  );
}

/**
 * Send a message via WuKongIM internal HTTP API (bypasses friendship checks).
 * Used to simulate user-side message sending.
 */
export async function sendViaWukongim(params: {
  wukongimApi: string;
  fromUid: string;
  channelId: string;
  channelType: ChannelType;
  payload: Record<string, unknown>;
}): Promise<void> {
  const payloadBase64 = Buffer.from(JSON.stringify(params.payload)).toString("base64");
  const resp = await fetch(`${params.wukongimApi}/message/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      header: { no_persist: 0, red_dot: 1, sync_once: 0 },
      from_uid: params.fromUid,
      channel_id: params.channelId,
      channel_type: params.channelType,
      payload: payloadBase64,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`WuKongIM message/send failed (${resp.status}): ${text}`);
  }
}

/**
 * Ensure a user's WuKongIM token is set (needed for WS connection).
 */
export async function ensureWukongimToken(params: {
  wukongimApi: string;
  uid: string;
  token: string;
}): Promise<void> {
  const resp = await fetch(`${params.wukongimApi}/user/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: params.uid, token: params.token }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`WuKongIM user/token failed (${resp.status}): ${text}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMessages(
  messages: unknown[],
  channelId: string,
  channelType: ChannelType,
): ReceivedMessage[] {
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
      messageId: m.message_id?.toString() ?? m.message_idstr ?? "",
      fromUid: m.from_uid ?? "unknown",
      channelId: m.channel_id ?? channelId,
      channelType: m.channel_type ?? channelType,
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
