/**
 * Shared mutable state across E2E test files.
 *
 * Vitest runs test files sequentially (default), so this module provides
 * a place to pass context (like the OpenClaw container instance) between
 * phases without relying on the filesystem.
 */

import type { OpenClawInstance } from "../lib/openclaw-setup.js";

export const sharedState: {
  openclawInstance?: OpenClawInstance;
  lastTestText?: string;
} = {};
