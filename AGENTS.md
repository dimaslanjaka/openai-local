# Anti-API — Agent Guide

Repo: Reverse proxy that exposes Antigravity's built-in AI models as OpenAI/Anthropic-compatible API. Five providers (Antigravity, Codex, Copilot, Zed, Kiro), smart routing, quota dashboard, tunnel support.

## Quickstart commands

```bash
bun install                            # install deps (Bun runtime, not npm)
bun run src/main.ts start              # default port 8964
bun run src/main.ts start -v           # verbose (consola level 4)
bun run src/main.ts add-account        # OAuth login for account rotation
bun run src/main.ts accounts           # list configured accounts
bun run src/main.ts logout-ide         # sign out IDE, clear auth
bun test                               # tests run SEQUENTIALLY (--test-concurrency 1)
bun test ./test/validation.test.ts     # single test file
bun run dev                            # alias for `bun run --watch src/main.ts start`
bun run build                          # bun build src/main.ts --outdir dist --target bun
```

## Project structure

- `src/main.ts` — CLI entrypoint (default, used in dev)
- `src/packaged-main.ts` — packaged build entry (starts Rust proxy subprocess, sets `ANTI_API_PUBLIC_DIR`)
- `src/portable-main.ts` — WinGet variant (just sets `PACKAGE_MANAGER=winget` then delegates to `packaged-main`)
- `src/server.ts` — Hono app instance exported as `server`; consumed via `Bun.serve()` in main
- `src/proto/encoder.ts` — reverse-engineered protobuf encoder; `MODEL_ENUM` maps model IDs to numeric enum values
- `rust-proxy/` — separate Rust crate, built with `cargo`, spawned as subprocess by packaged builds
- `public/` — HTML dashboards (quota, routing, remote panels)

### Service providers

```
src/services/antigravity/   — core Antigravity/Gemini provider
src/services/codex/         — ChatGPT Codex provider
src/services/copilot/       — GitHub Copilot provider
src/services/zed/           — Zed hosted models provider
src/services/kiro/          — Kiro provider
src/services/routing/       — flow + account routing engine
```

### API routes

```
src/routes/messages/   — Anthropic-compatible POST /v1/messages (also /v1beta/messages, /messages)
src/routes/openai/     — OpenAI-compatible POST /v1/chat/completions
src/routes/routing/    — routing config CRUD
src/routes/auth/       — auth endpoints
src/routes/remote/     — tunnel control
src/routes/logs/       — log buffer access
src/routes/updates/    — update checking
```

## TypeScript / build quirks

- **No ESLint, no Prettier, no Husky, no Lefthook**. Only `.editorconfig` (4-space indent, LF).
- Path alias `~/*` → `./src/*` via `tsconfig.json` `paths`. Used in imports like `import { x } from "~/lib/config"`.
- Module resolution: `"bundler"`, target `"ESNext"`.
- Strict mode enabled.

## Data & config

- Default data dir: `~/.anti-api/` (override with `ANTI_API_DATA_DIR`)
- Routing config JSON: `~/.anti-api/routing-config.json`
- Accounts JSON: `~/.anti-api/accounts.json`
- Legacy fallback: `./data/` (cwd)

## Testing patterns

- **Tests run sequentially** — `bun test` is configured with `--test-concurrency 1`. DO NOT assume parallel safety.
- Uses `bun:test` (`import { test, expect } from "bun:test"`).
- Tests that touch files use `withTempHome()`: creates a temp dir, swaps `HOME`/`USERPROFILE`, then `restoreEnv()` after. Dynamic imports use `?${Date.now()}` cache-busting.
- Example pattern:
  ```ts
  const { dir, prevHome, prevProfile } = withTempHome()
  const { loadRoutingConfig } = await import(`../src/services/routing/config.ts?${Date.now()}`)
  // ... test ...
  rmSync(dir, { recursive: true, force: true })
  restoreEnv(prevHome, prevProfile)
  ```

## Auth model

- **Token is never validated** — any string works as `Authorization: Bearer <any>` or `x-api-key: <any>`.
- Real auth is per-provider: Antigravity uses OAuth2, Copilot uses device-code flow, Codex reads `~/.codex/auth.json` + `~/.cli-proxy-api/`, Zed reads macOS keychain, Kiro has its own credential import.
- Server auto-imports Codex accounts on startup from `~/.codex/auth.json` and `~/.cli-proxy-api/`.

## Logging behavior

- `consola` level control:
  - `-v` flag → level 4 (debug)
  - default → level 0 (silent — only error responses are logged via middleware)
- Server middleware logs only **400+ responses** (with model/provider/account context when available).
- All 2xx responses are **silent** by default.

## Important env variables

| Variable | Purpose |
|----------|---------|
| `ANTI_API_DATA_DIR` | Override data directory |
| `ANTI_API_HOST` | Bind address (default `127.0.0.1`) |
| `ANTI_API_NO_OPEN=1` | Suppress browser auto-open |
| `ANTI_API_OAUTH_NO_OPEN=1` | Suppress OAuth link auto-open |
| `ANTI_API_NO_SELF_UPDATE=1` | Disable self-update |
| `ANTI_API_PACKAGE_MANAGER` | Set to `docker`/`winget` for package-manager-specific behavior |
| `ANTI_API_COPILOT_INSECURE_TLS=1` | Bypass Copilot TLS verification |
| `ANTI_API_CODEX_INSECURE_TLS=1` | Bypass Codex TLS verification |
| `ANTI_API_CODEX_REASONING_EFFORT` | Default: `medium`. Per-request override via `reasoning_effort` or `reasoning.effort` |
| `ANTI_API_PUBLIC_DIR` | Override dashboard static files directory |
| `ANTI_API_OAUTH_REDIRECT_URL` | Custom OAuth callback URL (needed for Docker/remote) |

## Model mapping

- `src/lib/config.ts` has `AVAILABLE_MODELS` — the static model list returned by `/v1/models`.
- `src/proto/encoder.ts` has `MODEL_ENUM` — reverse-engineered protobuf field numbers for Antigravity model selection.
- Dynamic model fetching per provider in `src/services/routing/models.ts` (`getProviderModels`).

## Docker specifics

- Multi-arch images (`linux/amd64`, `linux/arm64`) published to `ghcr.io/ink1ing/anti-api`.
- Health check hits `GET /auth/status`.
- OAuth callback ports: `51121-51131` (Antigravity), `1455-1465` (Codex).
- Copilot uses device-code flow (no callback port needed).
- No authentication on HTTP — do not expose to public internet.
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` for dev hot-reload.

## Other quirks

- OpenAI Responses API and Embeddings endpoints return 501 stubs.
- `/bundle/export` and `/bundle/import` return 410 Gone.
- Account rotation mechanism: on 429 response, mark account rate-limited for 60s, switch to next. Implemented in `account-manager.ts`.
- Flow routing: `model: "route:fast"` or `model: "fast"` triggers flow lookup. Official model IDs trigger account routing.
