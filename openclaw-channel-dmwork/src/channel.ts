import {
  DEFAULT_ACCOUNT_ID,
  type ChannelOutboundContext,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DmworkConfigJsonSchema } from "./config-schema.js";
import {
  listDmworkAccountIds,
  resolveDefaultDmworkAccountId,
  resolveDmworkAccount,
  type ResolvedDmworkAccount,
} from "./accounts.js";
import { registerBot, sendMessage, sendHeartbeat } from "./api-fetch.js";
import { WKSocket } from "./socket.js";
import { handleInboundMessage, type DmworkStatusSink } from "./inbound.js";
import { ChannelType, MessageType, type BotMessage, type MessagePayload } from "./types.js";
// HistoryEntry type - compatible with any version
type HistoryEntry = { sender: string; body: string; timestamp: number };
const DEFAULT_GROUP_HISTORY_LIMIT = 20;

// Session expiry configuration
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

// Module-level history storage — survives auto-restarts
const _historyMaps = new Map<string, Map<string, any[]>>();
function getOrCreateHistoryMap(accountId: string): Map<string, any[]> {
  let m = _historyMaps.get(accountId);
  if (!m) {
    m = new Map<string, any[]>();
    _historyMaps.set(accountId, m);
  }
  return m;
}

// Module-level member mapping: displayName -> uid
// Used to resolve @mentions in AI replies
const _memberMaps = new Map<string, Map<string, string>>();
function getOrCreateMemberMap(accountId: string): Map<string, string> {
  let m = _memberMaps.get(accountId);
  if (!m) {
    m = new Map<string, string>();
    _memberMaps.set(accountId, m);
  }
  return m;
}

// Module-level reverse mapping: uid -> displayName
// Used to show display names instead of uids in replies
const _uidToNameMaps = new Map<string, Map<string, string>>();
function getOrCreateUidToNameMap(accountId: string): Map<string, string> {
  let m = _uidToNameMaps.get(accountId);
  if (!m) {
    m = new Map<string, string>();
    _uidToNameMaps.set(accountId, m);
  }
  return m;
}

// Group member cache timestamps: groupId -> lastFetchedAt (ms)
const _groupCacheTimestamps = new Map<string, Map<string, number>>();
function getOrCreateGroupCacheTimestamps(accountId: string): Map<string, number> {
  let m = _groupCacheTimestamps.get(accountId);
  if (!m) {
    m = new Map<string, number>();
    _groupCacheTimestamps.set(accountId, m);
  }
  return m;
}

// Session last access timestamps: sessionId -> lastAccessAt (ms)
// Used for session expiry cleanup (fixes #34)
const _sessionLastAccessMaps = new Map<string, Map<string, number>>();
function getOrCreateSessionLastAccessMap(accountId: string): Map<string, number> {
  let m = _sessionLastAccessMaps.get(accountId);
  if (!m) {
    m = new Map<string, number>();
    _sessionLastAccessMaps.set(accountId, m);
  }
  return m;
}

/**
 * Update session last access timestamp.
 * Call this whenever a session is accessed (message received).
 */
export function touchSession(accountId: string, sessionId: string): void {
  const lastAccessMap = getOrCreateSessionLastAccessMap(accountId);
  lastAccessMap.set(sessionId, Date.now());
}

/**
 * Clean up expired sessions for an account.
 * Removes session data that hasn't been accessed for SESSION_EXPIRY_MS.
 * Returns the number of sessions cleaned up.
 */
export function cleanupExpiredSessions(accountId: string, log?: { info?: (msg: string) => void }): number {
  const now = Date.now();
  const lastAccessMap = _sessionLastAccessMaps.get(accountId);
  if (!lastAccessMap) return 0;

  const expiredSessions: string[] = [];
  for (const [sessionId, lastAccess] of lastAccessMap.entries()) {
    if (now - lastAccess > SESSION_EXPIRY_MS) {
      expiredSessions.push(sessionId);
    }
  }

  if (expiredSessions.length === 0) return 0;

  const historyMap = _historyMaps.get(accountId);
  const memberMap = _memberMaps.get(accountId);
  const uidToNameMap = _uidToNameMaps.get(accountId);
  const cacheTimestamps = _groupCacheTimestamps.get(accountId);

  for (const sessionId of expiredSessions) {
    lastAccessMap.delete(sessionId);
    historyMap?.delete(sessionId);
    // Note: memberMap and uidToNameMap are keyed by displayName/uid, not sessionId
    // We clear cacheTimestamps for the session (group)
    cacheTimestamps?.delete(sessionId);
  }

  log?.info?.(`dmwork: [CLEANUP] Cleaned up ${expiredSessions.length} expired sessions for account ${accountId}`);
  return expiredSessions.length;
}

const meta = {
  id: "dmwork",
  label: "DMWork",
  selectionLabel: "DMWork (WuKongIM)",
  docsPath: "/channels/dmwork",
  docsLabel: "dmwork",
  blurb: "WuKongIM gateway for DMWork",
  order: 90,
};

export const dmworkPlugin: ChannelPlugin<ResolvedDmworkAccount> = {
  id: "dmwork",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
  },
  reload: { configPrefixes: ["channels.dmwork"] },
  configSchema: DmworkConfigJsonSchema,
  config: {
    listAccountIds: (cfg) => listDmworkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDmworkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultDmworkAccountId(cfg),
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      apiUrl: account.config.apiUrl,
      botToken: account.config.botToken ? "[set]" : "[missing]",
      wsUrl: account.config.wsUrl ?? "[auto-detect]",
    }),
  },
  messaging: {
    normalizeTarget: (target) => target.trim(),
    targetResolver: {
      looksLikeId: (input) => Boolean(input.trim()),
      hint: "<userId or channelId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async (ctx) => {
      const account = resolveDmworkAccount({
        cfg: ctx.cfg as OpenClawConfig,
        accountId: ctx.accountId ?? DEFAULT_ACCOUNT_ID,
      });
      if (!account.config.botToken) {
        throw new Error("DMWork botToken is not configured");
      }
      const content = ctx.text?.trim();
      if (!content) {
        return { channel: "dmwork", to: ctx.to, messageId: "" };
      }

      // Parse target: "group:channel_id" for groups, "group:channel_id@uid1,uid2" for @mentions
      let channelId = ctx.to;
      let channelType = ChannelType.DM;
      let mentionUids: string[] = [];

      if (ctx.to.startsWith("group:")) {
        const groupPart = ctx.to.slice(6);
        const atIdx = groupPart.indexOf("@");
        if (atIdx >= 0) {
          channelId = groupPart.slice(0, atIdx);
          mentionUids = groupPart.slice(atIdx + 1).split(",").filter(Boolean);
        } else {
          channelId = groupPart;
        }
        channelType = ChannelType.Group;

        // Parse @mentions from message content (e.g., "@chenpipi_bot" -> "chenpipi_bot")
        // Match @username where username is alphanumeric with underscores (typical uid format)
        const contentMentions = content.match(/@([a-zA-Z0-9_]+)/g);
        if (contentMentions) {
          for (const mention of contentMentions) {
            const uid = mention.slice(1); // Remove @ prefix
            if (uid && !mentionUids.includes(uid)) {
              mentionUids.push(uid);
              console.log(`[dmwork] parsed @mention from content: ${uid}`);
            }
          }
        }
        if (mentionUids.length > 0) {
          console.log(`[dmwork] sending message with mentionUids: ${mentionUids.join(", ")}`);
        }
      }

      await sendMessage({
        apiUrl: account.config.apiUrl,
        botToken: account.config.botToken,
        channelId,
        channelType,
        content,
        ...(mentionUids.length > 0 ? { mentionUids } : {}),
      });

      return { channel: "dmwork", to: ctx.to, messageId: "" };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      apiUrl: account.config.apiUrl,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.configured || !account.config.botToken) {
        throw new Error(
          `DMWork not configured for account "${account.accountId}" (missing botToken)`,
        );
      }

      const log = ctx.log;
      const statusSink: DmworkStatusSink = (patch) =>
        ctx.setStatus({ accountId: account.accountId, ...patch });

      log?.info?.(`[${account.accountId}] registering DMWork bot...`);

      // 1. Register bot (first attempt uses cached token)
      let credentials: {
        robot_id: string;
        im_token: string;
        ws_url: string;
        owner_uid: string;
      };
      try {
        credentials = await registerBot({
          apiUrl: account.config.apiUrl,
          botToken: account.config.botToken,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log?.error?.(`dmwork: bot registration failed: ${message}`);
        statusSink({ lastError: message });
        throw err;
      }

      log?.info?.(
        `[${account.accountId}] bot registered as ${credentials.robot_id}`,
      );

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });

      // 2. Resolve WebSocket URL
      const wsUrl = account.config.wsUrl || credentials.ws_url;

      // 3. Start heartbeat timer
      let heartbeatTimer: NodeJS.Timeout | null = null;
      let cleanupTimer: NodeJS.Timeout | null = null;
      let stopped = false;

      const startHeartbeat = () => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        heartbeatTimer = setInterval(() => {
          if (stopped) return;
          sendHeartbeat({
            apiUrl: account.config.apiUrl,
            botToken: account.config.botToken!,
          }).catch((err) => {
            log?.error?.(`dmwork: heartbeat failed: ${String(err)}`);
          });
        }, account.config.heartbeatIntervalMs);
      };

      // Start session cleanup timer (fixes #34 - memory leak)
      const startCleanupTimer = () => {
        if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
        cleanupTimer = setInterval(() => {
          if (stopped) return;
          cleanupExpiredSessions(account.accountId, log);
        }, SESSION_CLEANUP_INTERVAL_MS);
      };

      // 4. Group history map — persists across auto-restarts (module-level)
      const groupHistories = getOrCreateHistoryMap(account.accountId);
      
      // 4b. Member name->uid map — for resolving @mentions in replies
      const memberMap = getOrCreateMemberMap(account.accountId);
      
      // 4c. Reverse map uid->name — for showing display names in replies
      const uidToNameMap = getOrCreateUidToNameMap(account.accountId);
      
      // 4d. Group cache timestamps — track when each group's members were last fetched
      const groupCacheTimestamps = getOrCreateGroupCacheTimestamps(account.accountId);

      // 5. Token refresh state — detect stale cached token
      let hasRefreshedToken = false;

      // 6. Connect WebSocket — pure real-time via WuKongIM SDK
      const socket = new WKSocket({
        wsUrl,
        uid: credentials.robot_id,
        token: credentials.im_token,

        onMessage: (msg: BotMessage) => {
          // Skip self messages
          if (msg.from_uid === credentials.robot_id) return;
          // Skip unsupported message types (Location, Card)
          const supportedTypes = [MessageType.Text, MessageType.Image, MessageType.GIF, MessageType.Voice, MessageType.Video, MessageType.File];
          if (!msg.payload || !supportedTypes.includes(msg.payload.type)) return;

          log?.info?.(
            `dmwork: recv message from=${msg.from_uid} channel=${msg.channel_id ?? "DM"} type=${msg.channel_type ?? 1}`,
          );

          // Track session activity for cleanup (fixes #34)
          const sessionId = msg.channel_type === ChannelType.Group && msg.channel_id
            ? msg.channel_id
            : msg.from_uid;
          touchSession(account.accountId, sessionId);

          handleInboundMessage({
            account,
            message: msg,
            botUid: credentials.robot_id,
            groupHistories,
            memberMap,
            uidToNameMap,
            groupCacheTimestamps,
            log,
            statusSink,
          }).catch((err) => {
            log?.error?.(`dmwork: inbound handler failed: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`);
          });
        },

        onConnected: () => {
          log?.info?.(`dmwork: WebSocket connected to ${wsUrl}`);
          statusSink({ lastError: null });
          startHeartbeat();
          startCleanupTimer();
          // WS connected successfully = WuKongIM accepted the token
        },

        onDisconnected: () => {
          log?.warn?.("dmwork: WebSocket disconnected, will reconnect...");
          statusSink({ lastError: "disconnected" });
        },

        onError: async (err: Error) => {
          log?.error?.(`dmwork: WebSocket error: ${err.message}`);
          statusSink({ lastError: err.message });

          // If kicked or connect failed, try refreshing the IM token once
          if (!hasRefreshedToken && !stopped &&
              (err.message.includes("Kicked") || err.message.includes("Connect failed"))) {
            hasRefreshedToken = true;
            log?.warn?.("dmwork: connection rejected — refreshing IM token...");
            try {
              const fresh = await registerBot({
                apiUrl: account.config.apiUrl,
                botToken: account.config.botToken!,
                forceRefresh: true,
              });
              credentials = fresh;
              log?.info?.("dmwork: got fresh IM token, reconnecting WS...");
              socket.disconnect();
              socket.updateCredentials(fresh.robot_id, fresh.im_token);
              socket.connect();
            } catch (refreshErr) {
              log?.error?.(`dmwork: token refresh failed: ${String(refreshErr)}`);
            }
          }
        },
      });

      socket.connect();

      // Keep Promise pending until stopped — gateway treats resolve as "account stopped"
      return new Promise((resolve) => {
        const cleanup = () => {
          if (stopped) return;
          stopped = true;
          socket.disconnect();
          if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
          ctx.setStatus({
            accountId: account.accountId,
            running: false,
            lastStopAt: Date.now(),
          });
          resolve({
            stop: () => { /* already cleaned up */ },
          });
        };

        if (ctx.abortSignal.aborted) {
          cleanup();
        } else {
          ctx.abortSignal.addEventListener("abort", cleanup, { once: true });
        }
      });
    },
  },
};
