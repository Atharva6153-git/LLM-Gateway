# PRD: AI Request Gateway (v1 — Routing, Failover, Rate Limiting)

## 1. Problem Statement

Teams building AI features call LLM providers (Groq, OpenAI, etc.) directly from
app code. This causes three recurring failures:

- **Single point of failure** — if the provider rate-limits, times out, or goes
  down, the app breaks with no fallback.
- **No traffic control** — one client/key can burn the whole quota, causing
  429s for everyone else.
- **Provider lock-in** — switching or adding a provider means rewriting app
  code, not changing config.

**Goal:** ship a lightweight gateway that sits between the app and LLM
providers, exposing one API, routing across multiple providers, failing over
automatically, and rate-limiting per client — with zero code change in the
app when a provider is added/removed/swapped.

## 2. Success Metrics

- Gateway survives a simulated provider outage (kill primary provider) with
  **0 failed end-user requests** — all traffic fails over to backup within
  one request cycle.
- Rate limiter blocks >429 threshold-breaching requests with **100% accuracy**
  in load test (no false positives under normal load).
- P95 added latency from gateway overhead (routing + limiter check) **< 50ms**
  on top of raw provider latency.
- Load test: sustain 50 req/s across 2 providers without dropped requests.

## 3. User Stories & Acceptance Criteria

**US-1: Unified endpoint**
As a developer, I call one gateway endpoint instead of provider-specific SDKs.
- AC: `POST /v1/chat` accepts a provider-agnostic payload (`{prompt, max_tokens, ...}`).
- AC: Response format is normalized regardless of which provider served it.

**US-2: Multi-provider routing**
As a developer, I configure providers without touching app code.
- AC: Providers defined in a config file/table (name, base URL, API key ref, priority).
- AC: Adding a provider to config makes it eligible for routing on next request — no redeploy of app code required (gateway restart/reload acceptable for v1).

**US-3: Automatic failover**
As a developer, my app keeps working if a provider fails.
- AC: If provider returns 5xx / times out / exceeds error threshold (e.g. 3 failures in 30s), circuit opens — no further requests sent to it for a cooldown window (e.g. 60s).
- AC: After cooldown, one "trial" request sent (half-open); success closes circuit, failure re-opens it.
- AC: All this is invisible to the calling app — it just gets a response from whichever provider succeeded.

**US-4: Per-client rate limiting**
As a developer, I don't want one API key to exhaust shared provider quota.
- AC: Each client (identified by API key) gets a token bucket (config: N tokens, refill rate).
- AC: Exceeding bucket returns `429` with `Retry-After` header — request is NOT forwarded to any provider.

**US-5: Observability**
As a developer, I can see what the gateway is doing.
- AC: `/metrics` endpoint or dashboard shows: requests per provider, failure count per provider, current circuit state per provider, rate-limit rejections per key.

## 4. Scope

**In scope (v1):**
- Unified `/v1/chat` endpoint, 2+ providers (Groq + one more, e.g. OpenAI or a second Groq-compatible model)
- Config-driven provider list (JSON/DB row, not hardcoded)
- Circuit breaker per provider (closed/open/half-open states)
- Token-bucket rate limiting per API key (Redis-backed)
- Round-robin or priority-order routing across healthy providers
- Basic metrics endpoint/dashboard
- Dockerized, runnable locally via docker-compose

**Out of scope (v1) — explicitly deferred:**
- Semantic caching (embeddings + similarity match) — v2
- Cost-based smart routing (cheap model for simple prompts) — v2
- Multi-tenant auth/billing system — not needed, single-team internal tool for v1
- Streaming responses (SSE) — v1 is request/response only
- Horizontal scaling of the gateway itself (multiple gateway instances behind LB) — v1 runs as single instance

## 5. Data Model Changes

New Postgres tables:

```
providers
  id            serial PK
  name          text            -- 'groq', 'openai'
  base_url      text
  api_key_ref   text            -- env var name, never store raw key in DB
  priority      int             -- lower = tried first
  enabled       boolean default true

api_clients
  id            serial PK
  api_key_hash  text unique     -- store hash, not raw key
  bucket_size   int             -- rate limit config
  refill_rate   int             -- tokens/sec

request_log
  id            serial PK
  client_id     int FK -> api_clients
  provider_id   int FK -> providers
  status        text            -- 'success' | 'failed' | 'rate_limited'
  latency_ms    int
  created_at    timestamptz default now()
```

Redis (ephemeral, not Postgres):
- `circuit:{provider_id}` → state (closed/open/half-open) + failure count, TTL-based cooldown
- `bucket:{client_id}` → current token count, last refill timestamp

## 6. Edge Cases & Failure States

- **All providers down** → return `503` with clear error, do not hang; log incident.
- **Provider returns malformed/non-JSON response** → treat as failure for circuit breaker purposes, do not forward garbage to client.
- **Rate limiter Redis unavailable** → fail open or closed? (see open questions) — must pick one, don't leave undefined.
- **Client sends request with unknown/revoked API key** → `401`, never forwarded to provider, does not count against any bucket.
- **Circuit half-open trial request also fails** → circuit re-opens immediately, cooldown timer resets (don't hammer a dead provider).
- **Two requests race on the same token bucket at once** → must be atomic (Lua script in Redis or `INCR`-based logic), not read-then-write (race condition drains bucket incorrectly).
- **Provider responds slowly but eventually succeeds (not timeout, just slow)** → counts as success for circuit breaker, but should log latency for metrics — slow ≠ down.

## 7. Open Questions (need your answer before/while building)

1. Redis down — should rate limiter **fail open** (allow all requests, risk overload) or **fail closed** (block all requests, risk false outage)? Pick one now.
2. What counts as "provider failure" for circuit breaker — HTTP 5xx only, or also timeouts and 429s from the provider itself?
3. Second provider for v1 demo — real second LLM API (OpenAI, needs paid key) or a mock/local server that simulates failures on command (easier to demo circuit breaker reliably, no real cost)?
4. Auth for gateway itself — static API keys in a table (v1, simple) or defer auth entirely and assume trusted internal network for the demo?
5. Where does gateway run for demo — local docker-compose only, or deployed (Render, per your `crypto-pulse`/`togglenest` deployment patterns) so it's a live link on your resume?
