#!/usr/bin/env bash
set -euo pipefail

# ─── E2E Test Runner ──────────────────────────────────────────────────────────
# Usage:
#   E2E_BOT_TOKEN=xxx E2E_DMWORK_API=http://... E2E_USER_TOKEN=xxx ./run.sh
#
# Or source a .env file first:
#   source .env && ./run.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Preflight checks ────────────────────────────────────────────────────────

echo "🔍 Preflight checks..."

for var in E2E_BOT_TOKEN E2E_DMWORK_API E2E_USER_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Missing required env var: $var"
    echo "   See e2e/README.md for setup instructions."
    exit 1
  fi
done

if ! command -v docker &>/dev/null; then
  echo "❌ Docker is required but not found in PATH"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required but not found in PATH"
  exit 1
fi

# ─── Install dependencies ────────────────────────────────────────────────────

if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# ─── Run tests ────────────────────────────────────────────────────────────────

echo "🚀 Running E2E tests..."
echo "   DMWork API: $E2E_DMWORK_API"
echo "   OpenClaw Image: ${E2E_OPENCLAW_IMAGE:-openclaw/openclaw:latest}"
echo ""

npx vitest run --reporter=verbose

echo ""
echo "✅ E2E tests complete."
