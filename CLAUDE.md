# CLAUDE.md

## Project

AI Request Gateway: a single API in front of multiple LLM providers with automatic
failover (per-provider circuit breaker) and per-client token-bucket rate limiting.
Providers are DB rows, so adding/swapping providers needs no app or code change.

## Tech stack & versions

- Runtime: Node >=20 (CommonJS, `"type": "commonjs"`), Docker image `node:20-alpine`
- Express `^4.19.2`, pg `^8.11.5`, ioredis `^5.4.1`, axios `^1.7.2`, dotenv `^16.4.5`
- Dev: nodemon `^3.1.0`, eslint `^9.5.0`
- Infra (docker-compose): postgres `16-alpine`, redis `7-alpine`
- `mock-provider/` is a standalone Express `^4.19.2` fake LLM on `node:20-alpine`

## Commands

- `npm run dev` — nodemon `src/index.js` (run on host)
- `npm start` — node `src/index.js`
- `docker compose up --build` — full stack: postgres, redis, mock-provider (:4000), gateway (:3000)
- `cp .env.example .env` before any local run
- ⚠ `npm test` (runs `node --test test/`) — no `test/` dir exists; fails today
- ⚠ `npm run lint` (runs `eslint src/`) — ESLint 9 needs flat config, none present; fails today
- ⚠ `npm run migrate` (runs `src/db/migrate.js`) — file does not exist; migrations run only via postgres `/docker-entrypoint-initdb.d`

## Architecture

```
src/index.js        bootstrap: dotenv, express.json(), /health, mounts routers
src/middleware/     auth.js — sha256(x-api-key), look up api_clients, attach req.client (401 otherwise)
src/routes/         chat.js, metrics.js — thin Express routers: validate, call lib/, map errors, write request_log
src/lib/            policy logic, no Express — router.js (failover), circuitBreaker.js, rateLimiter.js
src/db/             pool.js (pg Pool), redis.js (ioredis), migrations/001_init.sql (schema + mock provider seed)
mock-provider/      fake LLM: POST /chat echoes prompt; POST /simulate-fail toggles outage
docs/PRD            prd-llm-gateway.md — spec + open decisions
```

- Request flow: `POST /v1/chat` → auth (pg) → rate limit (Redis Lua, fails open) → relay
  to providers in priority order (lowest `priority` first) → `request_log` insert → normalized JSON.
- `request_log` is the single failure/success record; `/metrics` (GET) reads it grouped by provider
  plus circuit state from Redis and `rate_limited_total` by status `'rate_limited'`.
- Redis is ephemeral state (circuits `circuit:{id}`, buckets `bucket:{id}`); Postgres is the source of truth.
- Migration auto-seeds one provider: `mock` (priority 200, `base_url http://mock-provider:4000`, `api_key_env MOCK_NO_KEY_NEEDED`).

## Code conventions

- Naming: camelCase for identifiers and file names; router vars named `<name>Router`
  (e.g. `chatRouter`); async lib functions are action verbs (`allowRequest`, `recordSuccess`).
- Error handling: lib/ throws `Error` with a `.code` (`NO_PROVIDERS`, `ALL_FAILED`);
  routes try/catch, map known codes to 4xx/5xx, `console.error` only truly unexpected errors,
  and every request is written to `request_log` (success and failed) before responding.
- Routes → lib/: route handlers never call providers or Redis directly; they call `lib/router.forward` and
  `lib/rateLimiter.allowRequest`, then shape a normalized `res.json`. Keep routes thin.
- DB access: use parameterized `pool.query('... $1 ...', [val])` — never string interpolation.
- Redis keys: namespace them (`circuit:{providerId}`, `bucket:{clientId}`). Circuit states: `closed`/`open`/`half_open`.
- Secrets: store only `sha256` hex hashes of API keys (`hashKey` in `src/middleware/auth.js`);
  providers reference keys by env var name in `providers.api_key_env`, never by value.
- Config: read env at module load where used (circuitBreaker reads `CB_*` at top of file);
  `dotenv` is loaded once in `src/index.js`.
- Comments: explain "why", never "what" (e.g. Redis Lua atomicity, fail-open rationale, half-open trial convention).
- HTTP contract: `400` missing prompt, `401` missing/invalid key, `429` + `Retry-After: 1` on empty bucket,
  `503` all providers unavailable, `500` unexpected. Circuit state defaults to `closed` in `/metrics`.

## Week-1 gotchas

- PowerShell + curl: `\"` does not escape quotes — JSON arrives mangled and body-parser returns a
  `400 SyntaxError: Expected property name or '}' in JSON at position 1`. Use single-quoted `-d '{"prompt":"hello"}'`
  or `--data-binary "@file.json"`.
- The repo `.env` uses docker service names (`postgres`, `redis`); `.env.example` uses `localhost`.
  On the host (npm run dev) override both to `localhost`; inside compose use service names. `mock-provider:4000` is only resolvable inside the compose network.
- `npm test` / `npm run lint` / `npm run migrate` are broken today. Migrations only auto-apply on the first
  postgres init; use `docker compose down -v` to wipe the volume and re-seed.
- mock-provider failure mode is in-memory: after `POST /simulate-fail {"failing":true}`, every `/chat` call
  returns 500 until set false or the container restarts.
- Circuit state lives in Redis, not Postgres: `docker compose restart gateway` won't clear an open circuit;
  wait out `CB_COOLDOWN_SECONDS`, or `redis-cli`/restart redis to reset.
- Only one provider (mock) is seeded — with it failing you'll see `503 all providers unavailable`; add a second
  provider row to actually observe failover.
- Circuit-breaker tuning (`CB_FAILURE_THRESHOLD=3`, `CB_WINDOW_SECONDS=30`, `CB_COOLDOWN_SECONDS=60`) is read
  from env at first require — changing `.env` needs a gateway restart.
- Rate limiter intentionally FAILS OPEN when Redis is unreachable (design decision in PRD §7.1) — a Redis outage
  resets limits, not shutdowns.