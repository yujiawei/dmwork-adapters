/**
 * WuKongIM WebSocket client for E2E testing.
 *
 * Implements the WuKongIM binary protocol (CONNECT, CONNACK, SEND, SENDACK,
 * RECV, RECVACK, PING, PONG) with DH key exchange and AES-CBC encryption.
 *
 * Ported from openclaw-channel-dmwork/src/socket.ts — minimal version for
 * testing only (no OpenClaw dependencies).
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { generateKeyPair, sharedKey } from "curve25519-js";
import { Buffer } from "node:buffer";
import CryptoJS from "crypto-js";
import { Md5 } from "md5-typescript";

// ─── Protocol Constants ─────────────────────────────────────────────────────

const enum PacketType {
  CONNECT = 1,
  CONNACK = 2,
  SEND = 3,
  SENDACK = 4,
  RECV = 5,
  RECVACK = 6,
  PING = 7,
  PONG = 8,
  DISCONNECT = 9,
}

const PROTO_VERSION = 4;

// ─── Binary Encoder / Decoder ───────────────────────────────────────────────

class Encoder {
  private w: number[] = [];
  writeByte(b: number) { this.w.push(b & 0xff); }
  writeBytes(b: number[]) { this.w.push(...b); }
  writeInt16(b: number) { this.w.push((b >> 8) & 0xff, b & 0xff); }
  writeInt32(b: number) {
    this.w.push((b >> 24) & 0xff, (b >> 16) & 0xff, (b >> 8) & 0xff, b & 0xff);
  }
  writeInt64(n: bigint) {
    const hi = Number(n >> 32n);
    const lo = Number(n & 0xffffffffn);
    this.writeInt32(hi);
    this.writeInt32(lo);
  }
  writeString(s: string) {
    if (s && s.length > 0) {
      const arr = stringToUint(s);
      this.writeInt16(arr.length);
      this.w.push(...arr);
    } else {
      this.writeInt16(0);
    }
  }
  toUint8Array(): Uint8Array { return new Uint8Array(this.w); }
}

class Decoder {
  private offset = 0;
  constructor(private data: Uint8Array) {}
  readByte(): number { return this.data[this.offset++]; }
  readInt16(): number {
    const v = (this.data[this.offset] << 8) | this.data[this.offset + 1];
    this.offset += 2;
    return v;
  }
  readInt32(): number {
    const v =
      (this.data[this.offset] << 24) |
      (this.data[this.offset + 1] << 16) |
      (this.data[this.offset + 2] << 8) |
      this.data[this.offset + 3];
    this.offset += 4;
    return v >>> 0;
  }
  readInt64String(): string {
    let n = BigInt(0);
    for (let i = 0; i < 8; i++) {
      n = (n << 8n) | BigInt(this.data[this.offset + i]);
    }
    this.offset += 8;
    return n.toString();
  }
  readInt64BigInt(): bigint {
    let n = BigInt(0);
    for (let i = 0; i < 8; i++) {
      n = (n << 8n) | BigInt(this.data[this.offset + i]);
    }
    this.offset += 8;
    return n;
  }
  readString(): string {
    const len = this.readInt16();
    if (len <= 0) return "";
    const slice = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return uintToString(Array.from(slice));
  }
  readRemaining(): Uint8Array {
    const d = this.data.slice(this.offset);
    this.offset = this.data.length;
    return d;
  }
  readVariableLength(): number {
    let multiplier = 0;
    let rLength = 0;
    while (multiplier < 27) {
      const b = this.readByte();
      rLength = rLength | ((b & 127) << multiplier);
      if ((b & 128) === 0) break;
      multiplier += 7;
    }
    return rLength;
  }
}

// ─── String / Byte Helpers ──────────────────────────────────────────────────

function stringToUint(str: string): number[] {
  const encoded = unescape(encodeURIComponent(str));
  const arr: number[] = [];
  for (let i = 0; i < encoded.length; i++) arr.push(encoded.charCodeAt(i));
  return arr;
}

function uintToString(array: number[]): string {
  const encoded = String.fromCharCode(...array);
  return decodeURIComponent(escape(encoded));
}

function encodeVariableLength(len: number): number[] {
  const ret: number[] = [];
  while (len > 0) {
    let digit = len % 0x80;
    len = Math.floor(len / 0x80);
    if (len > 0) digit |= 0x80;
    ret.push(digit);
  }
  return ret.length > 0 ? ret : [0];
}

// ─── AES-CBC ────────────────────────────────────────────────────────────────

function aesDecrypt(data: Uint8Array, aesKey: string, aesIV: string): Uint8Array {
  const str = String.fromCharCode(...Array.from(data));
  const ciphertext = CryptoJS.enc.Base64.parse(str);
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.enc.Base64.stringify(ciphertext),
    CryptoJS.enc.Utf8.parse(aesKey),
    {
      keySize: 128 / 8,
      iv: CryptoJS.enc.Utf8.parse(aesIV),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  );
  return Uint8Array.from(Buffer.from(decrypted.toString(CryptoJS.enc.Utf8)));
}

function aesEncrypt(message: string, aesKey: string, aesIV: string): string {
  return CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(message),
    CryptoJS.enc.Utf8.parse(aesKey),
    {
      keySize: 128 / 8,
      iv: CryptoJS.enc.Utf8.parse(aesIV),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  ).toString();
}

// ─── Packet Encoding ────────────────────────────────────────────────────────

function encodeConnectPacket(opts: {
  uid: string;
  token: string;
  clientKey: string;
}): Uint8Array {
  const body = new Encoder();
  body.writeByte(PROTO_VERSION);   // version
  body.writeByte(0);               // deviceFlag (0 = app/bot)
  body.writeString(generateDeviceID() + "W"); // deviceID
  body.writeString(opts.uid);
  body.writeString(opts.token);
  body.writeInt64(BigInt(Date.now()));
  body.writeString(opts.clientKey);
  const bodyBytes = Array.from(body.toUint8Array());

  const frame = new Encoder();
  frame.writeByte((PacketType.CONNECT << 4) | 0);
  frame.writeBytes(encodeVariableLength(bodyBytes.length));
  frame.writeBytes(bodyBytes);
  return frame.toUint8Array();
}

function encodePingPacket(): Uint8Array {
  return new Uint8Array([(PacketType.PING << 4) | 0]);
}

function encodeRecvackPacket(messageID: string, messageSeq: number): Uint8Array {
  const body = new Encoder();
  body.writeInt64(BigInt(messageID));
  body.writeInt32(messageSeq);
  const bodyBytes = Array.from(body.toUint8Array());

  const frame = new Encoder();
  frame.writeByte((PacketType.RECVACK << 4) | 0);
  frame.writeBytes(encodeVariableLength(bodyBytes.length));
  frame.writeBytes(bodyBytes);
  return frame.toUint8Array();
}

function encodeSendPacket(opts: {
  clientSeqNo: number;
  channelID: string;
  channelType: number;
  encryptedPayload: number[];
}): Uint8Array {
  const body = new Encoder();
  body.writeByte(0);                      // setting byte
  body.writeInt32(opts.clientSeqNo);      // clientSeqNo
  body.writeString(generateDeviceID());   // clientMsgNo
  body.writeString(opts.channelID);
  body.writeByte(opts.channelType);
  body.writeBytes(opts.encryptedPayload);
  const bodyBytes = Array.from(body.toUint8Array());

  const frame = new Encoder();
  frame.writeByte((PacketType.SEND << 4) | 0);
  frame.writeBytes(encodeVariableLength(bodyBytes.length));
  frame.writeBytes(bodyBytes);
  return frame.toUint8Array();
}

function parseSettingByte(v: number) {
  return {
    receiptEnabled: ((v >> 7) & 0x01) > 0,
    topic: ((v >> 3) & 0x01) > 0,
    streamOn: ((v >> 1) & 0x01) > 0,
  };
}

function generateDeviceID(): string {
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Public Types ───────────────────────────────────────────────────────────

export interface WKMessage {
  messageId: string;
  messageSeq: number;
  fromUid: string;
  channelId: string;
  channelType: number;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ─── WuKongIM Client ────────────────────────────────────────────────────────

export class WuKongIMClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private needReconnect: boolean;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartTimer: ReturnType<typeof setInterval> | null = null;
  private pingRetryCount = 0;
  private aesKey = "";
  private aesIV = "";
  private dhPrivateKey: Uint8Array | null = null;
  private serverVersion = 0;
  private tempBuffer: number[] = [];
  private clientSeqNo = 0;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  constructor(
    private wsUrl: string,
    private uid: string,
    private token: string,
    private autoReconnect = true,
  ) {
    super();
    this.needReconnect = autoReconnect;
  }

  /** Connect and wait for CONNACK. Resolves on success, rejects on failure. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.needReconnect = this.autoReconnect;
      this.doConnect();
    });
  }

  /** Send a text message through WuKongIM. */
  sendText(channelId: string, channelType: number, text: string): void {
    const payloadJson = JSON.stringify({ type: 1, content: text });
    const encryptedBase64 = aesEncrypt(payloadJson, this.aesKey, this.aesIV);
    const encryptedBytes = stringToUint(encryptedBase64);
    this.clientSeqNo++;
    const packet = encodeSendPacket({
      clientSeqNo: this.clientSeqNo,
      channelID: channelId,
      channelType,
      encryptedPayload: encryptedBytes,
    });
    this.sendRaw(packet);
  }

  /** Gracefully disconnect. */
  disconnect(): void {
    this.needReconnect = false;
    this.connected = false;
    this.stopHeart();
    this.stopReconnectTimer();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  /** Force-close the WebSocket (simulates network failure). */
  forceClose(): void {
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  isConnected(): boolean { return this.connected; }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private doConnect(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.tempBuffer = [];
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.on("open", () => {
      this.tempBuffer = [];
      const seed = Uint8Array.from(stringToUint(generateDeviceID()));
      const keyPair = generateKeyPair(seed);
      this.dhPrivateKey = keyPair.private;
      const pubKey = Buffer.from(keyPair.public).toString("base64");
      ws.send(encodeConnectPacket({ uid: this.uid, token: this.token, clientKey: pubKey }));
    });

    ws.on("message", (data: ArrayBuffer | Buffer) => {
      const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
      this.handleRawData(bytes);
    });

    ws.on("close", () => {
      if (this.connected) {
        this.connected = false;
        this.emit("disconnected");
      }
      this.stopHeart();
      if (this.needReconnect) this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      if (this.connectReject) {
        this.connectReject(new Error(`WS connection error: ${err.message}`));
        this.connectResolve = null;
        this.connectReject = null;
      }
    });
  }

  private scheduleReconnect(): void {
    this.stopReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (this.needReconnect) this.doConnect();
    }, 3000);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private restartHeart(): void {
    this.stopHeart();
    this.pingRetryCount = 0;
    this.heartTimer = setInterval(() => {
      this.pingRetryCount++;
      if (this.pingRetryCount > 3) {
        this.stopHeart();
        if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
        if (this.connected) { this.connected = false; this.emit("disconnected"); }
        if (this.needReconnect) this.scheduleReconnect();
        return;
      }
      this.sendRaw(encodePingPacket());
    }, 60_000);
  }

  private stopHeart(): void {
    if (this.heartTimer) { clearInterval(this.heartTimer); this.heartTimer = null; }
  }

  private sendRaw(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private handleRawData(data: Uint8Array): void {
    this.tempBuffer.push(...Array.from(data));
    try {
      let lenBefore: number;
      do {
        lenBefore = this.tempBuffer.length;
        this.tempBuffer = this.unpackOne(this.tempBuffer);
      } while (lenBefore !== this.tempBuffer.length && this.tempBuffer.length >= 1);
    } catch {
      this.tempBuffer = [];
      if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
    }
  }

  private unpackOne(data: number[]): number[] {
    if (data.length === 0) return data;
    const packetType = data[0] >> 4;

    if (packetType === PacketType.PONG) { this.pingRetryCount = 0; return data.slice(1); }
    if (packetType === PacketType.PING) { return data.slice(1); }

    let pos = 1;
    let remLength = 0;
    let multiplier = 1;
    let hasMore = false;

    do {
      if (pos > data.length - 1) return data; // incomplete
      const digit = data[pos++];
      remLength += (digit & 127) * multiplier;
      multiplier *= 128;
      hasMore = (digit & 0x80) !== 0;
    } while (hasMore);

    const totalLength = pos + remLength;
    if (totalLength > data.length) return data; // incomplete

    this.onPacket(new Uint8Array(data.slice(0, totalLength)));
    return data.slice(totalLength);
  }

  private onPacket(data: Uint8Array): void {
    const firstByte = data[0];
    const packetType = firstByte >> 4;
    const flag = firstByte & 0x0f;

    const dec = new Decoder(data);
    dec.readByte();
    if (packetType !== PacketType.PING && packetType !== PacketType.PONG) {
      dec.readVariableLength();
    }

    switch (packetType) {
      case PacketType.CONNACK: this.onConnack(dec, (flag & 0x01) > 0); break;
      case PacketType.RECV: this.onRecv(dec); break;
      case PacketType.SENDACK: /* ignore */ break;
      case PacketType.DISCONNECT: this.onDisconnect(); break;
    }
  }

  private onConnack(dec: Decoder, hasServerVersion: boolean): void {
    if (hasServerVersion) this.serverVersion = dec.readByte();
    const _timeDiff = dec.readInt64BigInt();
    const reasonCode = dec.readByte();
    const serverKey = dec.readString();
    const salt = dec.readString();
    if (this.serverVersion >= 4) dec.readInt64BigInt(); // nodeId

    if (reasonCode === 1) {
      const serverPubKey = Uint8Array.from(Buffer.from(serverKey, "base64"));
      const secret = sharedKey(this.dhPrivateKey!, serverPubKey);
      const aesKeyFull = Md5.init(Buffer.from(secret).toString("base64"));
      this.aesKey = aesKeyFull.substring(0, 16);
      this.aesIV = salt && salt.length > 16 ? salt.substring(0, 16) : salt;

      this.connected = true;
      this.restartHeart();
      this.emit("connected");
      if (this.connectResolve) {
        this.connectResolve();
        this.connectResolve = null;
        this.connectReject = null;
      }
    } else {
      this.connected = false;
      this.needReconnect = false;
      const err = new Error(`CONNACK failed: reasonCode=${reasonCode}`);
      this.emit("error", err);
      if (this.connectReject) {
        this.connectReject(err);
        this.connectResolve = null;
        this.connectReject = null;
      }
    }
  }

  private onRecv(dec: Decoder): void {
    const settingByte = dec.readByte();
    const setting = parseSettingByte(settingByte);
    const _msgKey = dec.readString();
    const fromUID = dec.readString();
    const channelID = dec.readString();
    const channelType = dec.readByte();
    if (this.serverVersion >= 3) dec.readInt32(); // expire
    const _clientMsgNo = dec.readString();
    const messageID = dec.readInt64String();
    const messageSeq = dec.readInt32();
    const timestamp = dec.readInt32();
    if (setting.topic) dec.readString(); // topic
    const encryptedPayload = dec.readRemaining();

    // ACK immediately
    this.sendRaw(encodeRecvackPacket(messageID, messageSeq));

    // Decrypt
    let payloadObj: Record<string, unknown> = {};
    try {
      const decryptedBytes = aesDecrypt(encryptedPayload, this.aesKey, this.aesIV);
      payloadObj = JSON.parse(uintToString(Array.from(decryptedBytes)));
    } catch {
      return; // skip malformed payloads
    }

    const msg: WKMessage = {
      messageId: messageID,
      messageSeq,
      fromUid: fromUID,
      channelId: channelID,
      channelType,
      timestamp,
      payload: payloadObj,
    };
    this.emit("message", msg);
  }

  private onDisconnect(): void {
    this.connected = false;
    this.needReconnect = false;
    this.stopHeart();
    this.emit("disconnected");
  }
}
