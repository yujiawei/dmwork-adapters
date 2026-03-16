/**
 * Phase 2: OpenClaw Deployment
 *
 * Starts a fresh OpenClaw Docker container and verifies health.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  startOpenClaw,
  waitForHealth,
  stopOpenClaw,
  getContainerLogs,
  type OpenClawInstance,
} from "../lib/openclaw-setup.js";
import { sharedState } from "./shared-state.js";

describe("Phase 2: Deploy OpenClaw", { timeout: 90_000 }, () => {
  afterAll(async () => {
    // If tests fail before storing in shared state, clean up
    if (!sharedState.openclawInstance && (globalThis as any).__e2e_instance) {
      await stopOpenClaw((globalThis as any).__e2e_instance).catch(() => {});
    }
  });

  it("should start an OpenClaw Docker container", async () => {
    const instance = await startOpenClaw();
    expect(instance.containerId).toBeTruthy();
    expect(instance.httpPort).toBeGreaterThan(0);
    // Store for use in subsequent tests
    sharedState.openclawInstance = instance;
    (globalThis as any).__e2e_instance = instance;
  });

  it("should pass health check within 60s", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();
    await waitForHealth(instance!);
  });

  it("should have clean startup logs", async () => {
    const instance = sharedState.openclawInstance;
    expect(instance).toBeTruthy();
    const logs = await getContainerLogs(instance!);
    // Should not have fatal errors
    expect(logs.toLowerCase()).not.toContain("fatal");
  });
});
