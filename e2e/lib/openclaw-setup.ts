/**
 * OpenClaw Docker instance management for E2E tests.
 *
 * Starts a fresh OpenClaw container with minimal config, installs the
 * dmwork channel plugin, and provides health-check / teardown utilities.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sleep } from "./dmwork-client.js";

const execFileAsync = promisify(execFile);

const DEFAULT_OPENCLAW_IMAGE = "openclaw/openclaw:latest";
const CONTAINER_NAME_PREFIX = "e2e-openclaw";
const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;

export interface OpenClawInstance {
  containerId: string;
  containerName: string;
  httpPort: number;
  /** Full base URL, e.g. http://localhost:19380 */
  baseUrl: string;
}

// ─── Container lifecycle ─────────────────────────────────────────────────────

/**
 * Start a fresh OpenClaw Docker container.
 * Uses a random high port to avoid collisions.
 */
export async function startOpenClaw(params?: {
  image?: string;
  /** Override host port (default: random 19300-19399) */
  port?: number;
}): Promise<OpenClawInstance> {
  const image = params?.image ?? process.env.E2E_OPENCLAW_IMAGE ?? DEFAULT_OPENCLAW_IMAGE;
  const port = params?.port ?? (19300 + Math.floor(Math.random() * 100));
  const containerName = `${CONTAINER_NAME_PREFIX}-${port}`;

  // Remove stale container with same name (if any)
  await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => {});

  const { stdout } = await execFileAsync("docker", [
    "run", "-d",
    "--name", containerName,
    "-p", `${port}:8080`,
    "-e", "OPENCLAW_MINIMAL=1",
    image,
  ]);

  const containerId = stdout.trim();
  const baseUrl = `http://localhost:${port}`;

  return { containerId, containerName, httpPort: port, baseUrl };
}

/**
 * Wait until OpenClaw's health endpoint responds.
 */
export async function waitForHealth(
  instance: OpenClawInstance,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${instance.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }
  throw new Error(`OpenClaw health check timed out after ${timeoutMs}ms (${instance.baseUrl})`);
}

// ─── Plugin installation ─────────────────────────────────────────────────────

/**
 * Install openclaw-channel-dmwork into the running container and write config.
 */
export async function installPlugin(params: {
  instance: OpenClawInstance;
  botToken: string;
  dmworkApiUrl: string;
  dmworkWsUrl?: string;
}): Promise<void> {
  const { instance, botToken, dmworkApiUrl } = params;

  // Install the plugin package inside the container
  await dockerExec(instance.containerName, [
    "npm", "install", "openclaw-channel-dmwork@latest",
  ]);

  // Write channel config
  const config = JSON.stringify({
    botToken,
    apiUrl: dmworkApiUrl,
    ...(params.dmworkWsUrl ? { wsUrl: params.dmworkWsUrl } : {}),
    requireMention: true,
  });

  await dockerExec(instance.containerName, [
    "sh", "-c",
    `echo '${config}' > /app/config/channels/dmwork.json`,
  ]);
}

/**
 * Restart the OpenClaw gateway process inside the container.
 */
export async function restartGateway(instance: OpenClawInstance): Promise<void> {
  await dockerExec(instance.containerName, ["sh", "-c", "kill -HUP 1 || true"]);
  // Wait for gateway to come back
  await sleep(3_000);
  await waitForHealth(instance, 30_000);
}

// ─── Plugin verification ─────────────────────────────────────────────────────

/**
 * Check container logs for plugin load confirmation.
 */
export async function verifyPluginLoaded(instance: OpenClawInstance): Promise<boolean> {
  const { stdout } = await execFileAsync("docker", [
    "logs", "--tail", "100", instance.containerName,
  ]);
  return stdout.includes("dmwork") || stdout.includes("channel-dmwork");
}

/**
 * Check container logs for WebSocket connection establishment.
 */
export async function verifyWsConnected(instance: OpenClawInstance): Promise<boolean> {
  const { stdout } = await execFileAsync("docker", [
    "logs", "--tail", "200", instance.containerName,
  ]);
  // The plugin logs "WS connected" or similar on successful connection
  return (
    stdout.includes("connected") ||
    stdout.includes("CONNACK") ||
    stdout.includes("ws_url")
  );
}

// ─── Teardown ────────────────────────────────────────────────────────────────

/**
 * Stop and remove the OpenClaw container.
 */
export async function stopOpenClaw(instance: OpenClawInstance): Promise<void> {
  await execFileAsync("docker", ["stop", instance.containerName]).catch(() => {});
  await execFileAsync("docker", ["rm", "-f", instance.containerName]).catch(() => {});
}

/**
 * Clean up ALL e2e containers (in case of previous failed runs).
 */
export async function cleanupAllE2eContainers(): Promise<void> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps", "-a", "--filter", `name=${CONTAINER_NAME_PREFIX}`, "--format", "{{.Names}}",
    ]);
    const names = stdout.trim().split("\n").filter(Boolean);
    for (const name of names) {
      await execFileAsync("docker", ["rm", "-f", name]).catch(() => {});
    }
  } catch {
    // docker not available or no containers — fine
  }
}

// ─── Container logs ──────────────────────────────────────────────────────────

export async function getContainerLogs(
  instance: OpenClawInstance,
  tail = 200,
): Promise<string> {
  const { stdout, stderr } = await execFileAsync("docker", [
    "logs", "--tail", String(tail), instance.containerName,
  ]);
  return stdout + stderr;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function dockerExec(
  containerName: string,
  cmd: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec", containerName, ...cmd,
  ]);
  return stdout;
}
