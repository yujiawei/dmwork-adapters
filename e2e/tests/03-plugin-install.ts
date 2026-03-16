/**
 * Phase 3: Plugin Installation
 *
 * Installs openclaw-channel-dmwork into the running OpenClaw container,
 * configures it, restarts the gateway, and verifies plugin load + WS connection.
 */

import { describe, it, expect } from "vitest";
import {
  installPlugin,
  restartGateway,
  verifyPluginLoaded,
  verifyWsConnected,
  getContainerLogs,
} from "../lib/openclaw-setup.js";
import { waitUntil } from "../lib/assertions.js";
import { sharedState } from "./shared-state.js";
import { env } from "./env.js";

describe("Phase 3: Plugin Install", { timeout: 120_000 }, () => {
  it("should install openclaw-channel-dmwork package", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();

    await installPlugin({
      instance: instance!,
      botToken: env.botToken,
      dmworkApiUrl: env.dmworkApi,
    });
  });

  it("should restart gateway and pass health check", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();
    await restartGateway(instance!);
  });

  it("should show plugin loaded in logs", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();

    await waitUntil(
      async () => verifyPluginLoaded(instance!),
      { timeoutMs: 30_000, label: "plugin loaded" },
    );
  });

  it("should establish WebSocket connection to DMWork", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();

    await waitUntil(
      async () => verifyWsConnected(instance!),
      { timeoutMs: 30_000, label: "WS connected" },
    );

    // Log final state for debugging
    const logs = await getContainerLogs(instance!);
    expect(logs).toBeTruthy();
  });
});
