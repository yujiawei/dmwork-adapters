# DMWork Adapter E2E Tests

End-to-end tests that validate the full user journey: bot registration, OpenClaw deployment, plugin installation, and message handling (text, image, file, voice, group @mention, quote reply, reconnect).

## Prerequisites

- **Node.js** >= 22
- **Docker** (for OpenClaw container)
- A **DMWork server** with API access
- A **bot token** (created via BotFather `/newbot`)
- A **user token** (to simulate the other end of conversations)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `E2E_BOT_TOKEN` | Yes | Bot token from BotFather (`bf_...`) |
| `E2E_DMWORK_API` | Yes | DMWork server URL (e.g. `http://server:8090`) |
| `E2E_USER_TOKEN` | Yes | User token to simulate sending messages to the bot |
| `E2E_OPENCLAW_IMAGE` | No | OpenClaw Docker image (default: `openclaw/openclaw:latest`) |

## Quick Start

```bash
# Set environment variables
export E2E_BOT_TOKEN=bf_xxxxx
export E2E_DMWORK_API=http://your-dmwork-server:8090
export E2E_USER_TOKEN=your_user_token

# Run
cd e2e
./run.sh
```

Or run directly with npm:

```bash
cd e2e
npm install
npm test
```

## Test Phases

| Phase | File | Description |
|---|---|---|
| 1 | `01-bot-setup.ts` | Verify bot token, register with DMWork |
| 2 | `02-deploy-openclaw.ts` | Start OpenClaw Docker container, health check |
| 3 | `03-plugin-install.ts` | Install plugin, configure, restart gateway, verify WS |
| 4a | `04-text-messaging.ts` | Send text to bot, verify response |
| 4b | `05-send-media.ts` | Upload + send image/file/voice (v0.4.0 sendMedia) |
| 4c | `06-group-mention.ts` | @mention bot in group, verify response |
| 4d | `07-quote-reply.ts` | Reply to message, verify context |
| 4e | `08-reconnect.ts` | Restart gateway, verify auto-reconnect |
| 5 | `09-cleanup.ts` | Stop and remove Docker container |

## Project Structure

```
e2e/
├── run.sh              # Main entry script
├── vitest.config.ts    # Test runner config
├── package.json
├── tsconfig.json
├── lib/
│   ├── dmwork-client.ts    # DMWork API client (user-side simulation)
│   ├── openclaw-setup.ts   # Docker instance management
│   └── assertions.ts       # Test assertion helpers
├── tests/
│   ├── env.ts              # Environment variable resolution
│   ├── shared-state.ts     # Cross-phase shared state
│   ├── 01-bot-setup.ts     # ... through 09-cleanup.ts
│   └── ...
└── fixtures/
    ├── test-image.png      # Minimal valid PNG
    ├── test-file.pdf       # Minimal valid PDF
    └── test-voice.mp3      # Minimal valid MP3
```

## Notes

- Tests run **sequentially** — each phase depends on the previous one.
- The OpenClaw container uses a random port in the 19300-19399 range.
- All Docker resources are cleaned up in Phase 5, even if earlier phases fail.
- Group mention tests are skipped if the bot isn't in any group.
