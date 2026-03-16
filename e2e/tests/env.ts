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
  /** Bot token for DMWork bot API */
  get botToken(): string { return required("E2E_BOT_TOKEN"); },
  /** DMWork API server URL */
  get dmworkApi(): string { return required("E2E_DMWORK_API"); },
  /** User auth token (DMWork API) */
  get userToken(): string { return required("E2E_USER_TOKEN"); },
  /** User UID */
  get userUid(): string { return required("E2E_USER_UID"); },
  /** Fixed SMS verification code */
  get smsCode(): string { return process.env.E2E_SMS_CODE ?? "123456"; },
  /** WuKongIM WebSocket endpoint (local override) */
  get wukongimWs(): string { return required("E2E_WUKONGIM_WS"); },
  /** WuKongIM internal HTTP API (for message injection). Auto-detected if not set. */
  get wukongimApi(): string {
    return process.env.E2E_WUKONGIM_API ?? "";
  },
};
