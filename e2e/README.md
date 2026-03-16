# DMWork Adapter E2E Tests

End-to-end tests for the DMWork adapter (`openclaw-channel-dmwork`).
Tests run directly against a real DMWork server — no Docker OpenClaw instance required.

## What's Tested

| # | Test Suite | Description |
|---|-----------|-------------|
| 01 | Bot Registration | `POST /v1/bot/register` — verify token, get WuKongIM credentials |
| 02 | Text Messaging | User sends text via WuKongIM → bot receives via WS → bot replies via REST → verify sync |
| 03 | sendMedia: Image | Upload image via `/v1/file/upload` → bot sends as type=2 → verify delivery |
| 04 | sendMedia: File | Upload PDF via `/v1/file/upload` → bot sends as type=8 → verify delivery |
| 05 | Group @bot | Send @mention in group → bot receives via WuKongIM (skipped if no group) |
| 06 | Reconnect | Force-close WS → verify auto-reconnect → verify message receipt resumes |

## Prerequisites

- DMWork server running (API + WuKongIM)
- A registered bot with valid token
- A test user account with valid credentials

## Environment Variables

```bash
# Required
export E2E_DMWORK_API=http://localhost:8090    # DMWork API server
export E2E_BOT_TOKEN=bf_xxx                    # Bot token from BotFather
export E2E_USER_TOKEN=xxx                      # Test user auth token
export E2E_USER_UID=xxx                        # Test user UID
export E2E_WUKONGIM_WS=ws://localhost:5200     # WuKongIM WebSocket endpoint

# Optional
export E2E_SMS_CODE=123456                     # SMS verification code (default: 123456)
export E2E_WUKONGIM_API=http://172.x.x.x:5001 # WuKongIM internal HTTP API (auto-detected from Docker)
```

### WuKongIM API Auto-Detection

The tests need access to the WuKongIM internal HTTP API (port 5001) for message
injection. If `E2E_WUKONGIM_API` is not set, the tests will auto-detect it by
inspecting the `tsdd-wukongim-1` Docker container.

## Running Tests

```bash
cd e2e

# Install dependencies
npm install

# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Type-check only
npm run type-check
```

## Fixtures

Test fixtures are in `e2e/fixtures/`:

- `test-image.png` — Minimal 1×1 PNG (69 bytes)
- `test-file.pdf` — Minimal PDF document (316 bytes)
- `test-voice.mp3` — Minimal MP3 file (417 bytes, not used in current tests)

## Architecture

```
e2e/
├── lib/
│   ├── dmwork-client.ts      # Bot REST API + WuKongIM message injection
│   ├── wukongim-client.ts    # WuKongIM binary protocol WebSocket client
│   └── assertions.ts         # Test assertion helpers
├── tests/
│   ├── env.ts                # Environment variable resolution
│   └── 01-06*.ts             # Test suites (run sequentially by filename)
├── fixtures/                 # Test files for upload
├── vitest.config.ts          # Vitest configuration
└── package.json
```

### Key Design Decisions

- **No OpenClaw dependency**: Tests exercise the DMWork bot API and WuKongIM protocol
  directly, exactly as the adapter does. This makes tests faster and more focused.
- **WuKongIM binary protocol**: The `wukongim-client.ts` implements CONNECT, CONNACK,
  SEND, RECV, RECVACK, PING/PONG with DH key exchange and AES-CBC encryption — the same
  protocol used by the production adapter.
- **WuKongIM internal API**: User-side message sending uses the WuKongIM HTTP API
  (`/message/send`) to bypass friendship restrictions, simulating real user messages
  at the IM protocol level.
- **Bot owner as target**: Media and outbound text tests send to the bot's owner
  (the user who created the bot), since bot→user DMs require a friendship relationship
  in DMWork.
- **Sequential execution**: Tests run in filename order because later tests may depend
  on state created by earlier ones (e.g., bot registration).
