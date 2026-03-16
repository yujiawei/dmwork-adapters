import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files sequentially — phases depend on each other
    sequence: {
      concurrent: false,
    },
    // Sort test files by name to ensure correct phase order
    include: ["tests/**/*.ts"],
    // Generous timeout for Docker + network operations
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
