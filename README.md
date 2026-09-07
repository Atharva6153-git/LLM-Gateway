# llm-gateway

[![CI](https://github.com/Atharva6153-git/LLM-Gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Atharva6153-git/LLM-Gateway/actions/workflows/ci.yml)

One API in front of multiple LLM providers — with automatic circuit-breaker
failover and per-client token-bucket rate limiting.

- **Providers are DB rows** — add, remove, or re-prioritize an LLM provider with
  an `INSERT`, no code change or redeploy.
- **Clients are DB rows** — per-API-key rate limits configured in the database.
- **Failover by default** — if a provider trips its circuit breaker, traffic
  rolls to the next healthy one.

---

## Table of contents

1. [Architecture](#architecture)
2. [Endpoints](#endpoints)
3. [Quick start (localhost)](#quick-start-localhost)
4. [Configuration](#configuration)
5. [Key behaviors](#key-behaviors)
6. [Testing](#testing)
7. [Deploying](#deploying)

---

## Architecture

![request flow](docs/architecture.svg)

```
POST /v1/chat
  → 1. Auth        sha256(x-api-key) vs api_clients (Postgres)     401 on miss
  → 2. Rate limit  token bucket (Redis Lua, atomic)                429 when empty
  → 3. Failover    providers sorted by priority (lowest first),
                   each gated by a circuit breaker (Redis)         503 if all fail
  → 4. Adapter     per-provider body shape (flat / openai)
  → 5. Log         request_log row → normalized JSON response
```

Postgres is the source of truth (clients, providers, request_log). Redis holds
ephemeral runtime state (circuits, buckets) and can go away safely.

## Endpoints

| Method | Path        | Auth                  | Purpose                          |
| ------ | ----------- | --------------------- | -------------------------------- |
| GET    | `/`         | —                     | Endpoint index                   |
| GET    | `/health`   | —                     | Liveness probe (always 200)      |
| GET    | `/status`   | —                     | Reports `db` / `redis` health    |
| POST   | `/v1/chat`  | `x-api-key` header    | Chat completion with failover    |
| GET    | `/metrics`  | `x-admin-key` header  | Per-provider stats + circuit state |

**Chat request**

```bash
curl -X POST localhost:3000/v1/chat \
  -H "x-api-key: test123" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "hello"}'
```

**Chat response**

```json
{
  "provider": "mock",
  "latency_ms": 16,
  "response": { "text": "…", "model": "mock-model-v1" }
}
```

## Quick start (localhost)

```bash
cp .env.example .env.docker
docker compose up --build
```

| What starts     | Port  | Notes                                   |
| --------------- | ----- | --------------------------------------- |
| gateway         | 3000  | the API                                 |
| postgres        | 5432  | auto-runs init migrations, seeds providers |
| redis           | 6379  | rate-limit buckets + circuit state      |
| mock-provider   | 4000  | fake LLM for the failover demo          |

Create a test client (raw key `test123`):

```sql
INSERT INTO api_clients (name, api_key_hash, bucket_size, refill_rate)
VALUES ('test-client', encode(digest('test123', 'sha256'), 'hex'), 20, 5);
```

Or skip the SQL entirely — set `SEED_CLIENT_KEY` in the env file and the
gateway inserts the client on first boot.

**Demo the failover**

```bash
curl -X POST localhost:4000/simulate-fail -d '{"failing": true}' -H "Content-Type: application/json"
```

Hit `/v1/chat` 3+ times — the `mock` provider's circuit opens (503s) and
traffic moves on. Recovery: `{"failing": false}`.

> **Env file gotcha:** Docker uses `.env.docker` (service names); host
> `npm run dev` uses `.env.local`. `.dockerignore` keeps env files out of
> image builds.

## Configuration

`.env.example` documents every variable. Runtime behavior is read from DB rows
(`api_clients`, `providers`), not env — the key ones:

| Variable                   | Default | Meaning                                        |
| -------------------------- | ------- | ---------------------------------------------- |
| `DATABASE_URL`             | —       | Postgres connection string                     |
| `REDIS_URL`                | —       | Redis connection string (optional locally)     |
| `GROQ_API_KEY`             | —       | Real provider key (referenced by `providers.api_key_env`) |
| `ADMIN_API_KEY`            | —       | Required for `/metrics`; unset → denied        |
| `SEED_CLIENT_KEY`          | —       | On boot, creates this client (no SQL needed)   |
| `RATE_LIMIT_FAIL_OPEN`     | `true`  | `false` → 503 on Redis outage (fail closed)    |
| `MAX_TOKENS`               | `8192`  | Clamp for client-supplied `max_tokens`         |
| `LOG_RETENTION_DAYS`       | `30`    | Prunes `request_log`; `0` disables             |
| `AUTH_MAX_FAILURES`        | `5`     | Per-IP brute-force lockout threshold           |
| `AUTH_FAIL_WINDOW_SECONDS` | `60`    | Lockout window after failures                  |
| `CB_FAILURE_THRESHOLD`     | `3`     | Failures before a circuit opens (30s window)   |
| `CB_COOLDOWN_SECONDS`      | `60`    | How long an open circuit stays shut            |

## Key behaviors

- **Circuit breaker** — `3` failures in `30s` window opens a circuit for `60s`;
  then `half_open` admits exactly one trial request; success resets it.
- **Rate limit** — token bucket; capacity/refill per client row; `429` +
  `Retry-After: 1` when empty.
- **Failover** — providers tried in `priority` order, once each; all failed →
  `503`. Measured locally: mock ~16 ms, Groq ~300–370 ms per call.
- **Secrets** — only sha256 hashes stored; raw keys never logged; env files
  excluded from the image; constant-time compare for admin keys.
- **Security posture** — nosniff / frame-deny / no-store headers, `max_tokens`
  clamped, non-root container (`USER node`), healthchecked services.

## Testing

```bash
npm run lint     # eslint (flat config)
npm test         # node:test unit tests
npm audit        # dependency audit (0 known vulns)
```

All three run automatically in CI (GitHub Actions) on every push/PR, plus a
`docker build` to catch Dockerfile regressions.

## Deploying

The fastest path on **Render**:

1. Create a Postgres service → copy its **Internal Database URL**.
2. **New → Web Service** → `LLM-Gateway` repo → **runtime: Docker**.
3. In **Environment**: `DATABASE_URL`, `GROQ_API_KEY`, `ADMIN_API_KEY`,
   `SEED_CLIENT_KEY`, and `RATE_LIMIT_FAIL_OPEN=false` (strict prod).
4. Deploy. Migrations apply on first boot; the seed client is created
   automatically.

Notes:

- A `render.yaml` blueprint lives in the repo as an alternative path.
- Terminate TLS at the platform (Caddy/nginx/Render proxy) — the app speaks
  plain HTTP behind it.
- Apply migrations to an *existing* DB with `npm run migrate` (init scripts
  only run on fresh databases).
- Replace the demo `test123` client and default admin key before going public.
- `mock-provider` only exists in Docker — on Render it opens its circuit and
  Groq handles traffic, which is the failover story working as designed.