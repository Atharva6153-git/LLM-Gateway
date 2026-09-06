# CLAUDE.md

## Project

AI Request Gateway: one API in front of multiple LLM providers with per-provider
circuit-breaker failover and per-client token-bucket rate limiting. Providers and
clients are DB rows, so adding/swapping providers needs no app or code change.

## Tech stack & versions

- Runtime: Node >=20 (CommonJS, `"type": "commonjs"`), Docker image `node:20-alpine`
- Dependencies: express `^4.19.2`, pg `^8.11.5`, ioredis `^5.4.1`, axios `^1.7.2`, dotenv `^16.4.5`
- Dev: nodemon `^3.1.0`, eslint `^9.5.0`
- Infra (docker-compose): postgres `16-alpine`, redis `7-alpine`
- `mock-provider/` is a standalone Express fake LLM on `node:20-alpine`, port 4000

## Commands

- `npm run dev` — nodemon `src/index.js` (run on host)
- `npm start` — node `src/index.js` (also the Docker CMD)
- `docker compose up --build` — full stack: postgres, redis, mock-provider (:4000), gateway (:3000)
- `cp .env.example .env` before any run
- ⚠ Broken today, don't rely on them:
  - `npm test` (runs `node --test test/`) — no `test/` dir exists
  - `npm run lint` (runs `eslint src/`) — ESLint 9 needs a flat config, none present
  - `npm run migrate` (runs `src/db/migrate.js`) — file does not exist; migrations only
    auto-apply via postgres `/docker-entrypoint-initdb.d` on first init

## Architecture

```
src/index.js        bootstrap: dotenv, express.json(), /health, mounts routers
src/middleware/     auth.js — sha256(x-api-key), look up api_clients, attach req.client (401 otherwise)
src/routes/         chat.js, metrics.js — Express routers: validate, call lib/, map errors, write request_log
src/lib/            policy logic, no Express — router.js (failover), circuitBreaker.js, rateLimiter.js
src/db/             pool.js (pg Pool), redis.js (ioredis), migrations/001_init.sql (schema + mock seed)
mock-provider/      fake LLM: POST /chat echoes prompt; POST /simulate-fail toggles outage
docs/PRD            prd-llm-gateway.md — spec + open decisions
```

- Request flow: `POST /v1/chat` → auth (pg) → rate limit (Redis Lua, fails open) -> relay
  to providers in priority order (lowest `priority` first, `router.forward` -> axios POST
  `${base_url}/chat`, 10s timeout) → `request_log` insert → normalized JSON.
- `request_log` is the single success/failure record; `/metrics` reads it grouped by provider,
  plus circuit state from Redis and `rate_limited_total` (status `'rate_limited'`).
- Redis is ephemeral state (circuits `circuit:{id}`, buckets `bucket:{id}`); Postgres is the source of truth.
- Migration auto-seeds one provider: `mock` (priority 200, `base_url http://mock-provider:4000`,
  `api_key_env MOCK_NO_KEY_NEEDED`).
- Providers reference API keys by env-var name in `api_key_env`; router reads `process.env[name]`

## Code conventions

- Naming: camelCase for identifiers and file names; router vars named `<name>Router`
  (`chatRouter`, `metricsRouter`); async lib functions are action verbs (`allowRequest`, `recordSuccess`).
- Error handling: lib/ throws `Error` with a `.code` (`NO_PROVIDERS`, `ALL_FAILED`);
  routes map known codes to 4xx/5xx and `console.error` only truly unexpected errors -> 500.
- Lib API: expose async functions that return data or throw coded Errors; never return error objects.
- Keep routes thin: chat.js defers to `lib/router.forward` + `lib/rateLimiter.allowRequest`.
  ⚠ Known deviation: metrics.js queries `pool` and `redis` inline instead of going through lib/.
- Every forwarded attempt is recorded in `request_log` (success with `provider_id`, failure with
  `provider_id` NULL) before responding. ⚠ Rate-limited requests (429) are NOT logged — see gotchas.
- DB access: parameterized `pool.query('... $1 ...', [val])` — never string interpolation.
- Redis keys: namespace them (`circuit:{providerId}`, `bucket:{clientId}`).
  Circuit states: `closed`/`open`/`half_open`; default to `closed` when missing.
- Secrets: store only sha256 hex hashes of API keys (`hashKey` in `src/middleware/auth.js`);
  never write a raw key to the DB or a log.
- Config: read env at module load where used (circuitBreaker reads `CB_*` at top of file);
  `dotenv` loads once in `src/index.js`.
- Comments: explain "why", never "what" (e.g. Lua atomicity, fail-open rationale).
- HTTP contract: `400` missing prompt, `401` missing/invalid key, `429` + `Retry-After: 1` on empty
  bucket, `503` for `NO_PROVIDERS`/`ALL_FAILED`, `500` unexpected; `/health` -> 200 `{ok:true}`.
- Remove debug `console.error` (`[router] DEBUG`, `[CB DEBUG]`) when touching router.js/circuitBreaker.js.

## Week-1 gotchas

- PowerShell + curl: `\"` does not escape quotes — JSON arrives mangled and body-parser returns
  `400 SyntaxError`. Use single-quoted `-d '{"prompt":"hello"}'` or `--data-binary "@file.json"`.
- The repo `.env` uses docker service names (`postgres`, `redis`); `.env.example` uses `localhost`.
  On the host (`npm run dev`) override both to `localhost`; inside compose use service names.
  `mock-provider:4000` resolves only inside the compose network.
- Migrations auto-apply only on the first postgres init; run `docker compose down -v` to wipe the
  volume and re-seed.
- mock-provider failure mode is in-memory: after `POST /simulate-fail {"failing":true}`, every `/chat`
  returns 500 until set false or the container restarts.
- Circuit state (and failure counts) live in Redis, not Postgres: `docker compose restart gateway`
  won't clear an open circuit; wait out `CB_COOLDOWN_SECONDS` or restart redis.
- Only one provider (mock) is seeded — with it failing you'll see `503 all providers unavailable`;
  insert a second provider row to actually observe failover.
- Circuit-breaker tuning (`CB_FAILURE_THRESHOLD=3`, `CB_WINDOW_SECONDS=30`, `CB_COOLDOWN_SECONDS=60`)
  is read from env at first require — changing `.env` needs a gateway restart.
- Rate limiter intentionally FAILS OPEN when Redis is unreachable (PRD §7.1): a Redis outage resets
  limits, not shutdowns.
- ⚠ `request_log` never gets a `'rate_limited'` row, so `/metrics` `rate_limited_total` is always 0.
  If you want the metric to be real, write a `request_log` row in the 429 branch.
- ⚠ `half_open` does NOT actually admit one trial request: `canRequest` returns true for every
  request while state isn't `open`, so a burst can slip through. The "one trial" is comment-only.
- ⚠ Express 4 doesn't catch rejected promises in async handlers: `auth.js` and `metrics.js` have no
  try/catch, so a DB/Redis error there rejects unhandled (Node >=15 crashes on unhandledRejection).
  Wrap async handlers in try/catch or you'll see the gateway die on a transient pg error.
- `.env.example`'s `DEFAULT_BUCKET_SIZE`, `DEFAULT_REFILL_RATE`, `GROQ_*`, `MOCK_PROVIDER_URL` are
  documentation-only — the app reads every value from DB rows (`api_clients.bucket_size/refill_rate`,
  `providers.base_url/api_key_env`). Don't add app reads of these env vars expecting them to matter.