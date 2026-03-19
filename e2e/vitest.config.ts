import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files sequentially — phases depend on each other
    sequence: {
      concurrent: false,
    },
    // Sort test files by name to ensure correct phase order
    include: ["tests/[0-9]*.ts"],
    // Generous timeout for network operations
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
