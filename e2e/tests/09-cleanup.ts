/**
 * Phase 5: Cleanup
 *
 * Stops and removes all E2E Docker containers and resources.
 */

import { describe, it, expect } from "vitest";
import {
  stopOpenClaw,
  cleanupAllE2eContainers,
} from "../lib/openclaw-setup.js";
import { sharedState } from "./shared-state.js";

describe("Phase 5: Cleanup", { timeout: 30_000 }, () => {
  it("should stop the OpenClaw container", async () => {
    const instance = sharedState.openclawInstance;
    if (instance) {
      await stopOpenClaw(instance);
      sharedState.openclawInstance = undefined;
    }
    expect(true).toBe(true);
  });

  it("should clean up any stale E2E containers", async () => {
    await cleanupAllE2eContainers();
    expect(true).toBe(true);
  });
});
