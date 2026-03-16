/**
 * E2E environment variable resolution.
 * Fails fast with clear messages if required vars are missing.
 */

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Set it before running E2E tests. See e2e/README.md for details.`,
    );
  }
  return val;
}

export const env = {
  get botToken(): string { return required("E2E_BOT_TOKEN"); },
  get dmworkApi(): string { return required("E2E_DMWORK_API"); },
  get userToken(): string { return required("E2E_USER_TOKEN"); },
  get openclawImage(): string {
    return process.env.E2E_OPENCLAW_IMAGE ?? "openclaw/openclaw:latest";
  },
};
