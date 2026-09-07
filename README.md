# llm-gateway

AI Request Gateway — routes requests across LLM providers with automatic
failover (circuit breaker) and per-client rate limiting. See `docs/prd-llm-gateway.md`
for the full spec and open decisions.

## Run locally

```
cp .env.example .env
docker compose up --build
```

> Env files: `npm run dev` on the host uses `.env.local` (localhost); Docker
> (`docker compose up`) uses `.env.docker` (service names postgres/redis).

This starts: postgres (auto-runs migration), redis, mock-provider (fake LLM
for failover demo), and the gateway on :3000.

## Create a test client

Manually insert into `api_clients` (raw key `test123`, hash it with sha256):

```sql
INSERT INTO api_clients (name, api_key_hash, bucket_size, refill_rate)
VALUES ('test-client', encode(digest('test123', 'sha256'), 'hex'), 20, 5);
```

## Try it

```
curl -X POST localhost:3000/v1/chat \
  -H "x-api-key: test123" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "hello"}'
```

## Demo the failover

```
curl -X POST localhost:4000/simulate-fail -d '{"failing": true}' -H "Content-Type: application/json"
```

Hit `/v1/chat` 3+ times — circuit opens on `mock` provider after threshold,
requests get routed to next healthy provider (add a real one, e.g. Groq, in
the `providers` table to see actual failover — with only 1 provider it'll
just start returning 503).

Check `/metrics` to see circuit state and request counts (requires
`x-admin-key` — set `ADMIN_API_KEY` in the env file).

## Deploying

- Requirements: Docker + Docker Compose, Node >=20 for host tooling.
- Secrets live only in gitignored env files — `.env.docker` (compose) or
  `.env.local` (host). The committed `.env.example` is the template; create
  the real file from it and never commit it. `.dockerignore` keeps env files
  out of image layers.
- Apply schema migrations to an existing DB with `npm run migrate` (init
  scripts only run on first postgres init); fresh `docker compose up` seeds
  automatically.
- Set `ADMIN_API_KEY` before exposing `/metrics`, and override the sample
  `test123` client. `RATE_LIMIT_FAIL_OPEN=false` makes the gateway reject
  503s instead of admitting unlimited traffic if Redis goes down.
- Terminate TLS at a reverse proxy (Caddy/nginx) in front of :3000; the app
  itself speaks plain HTTP. Healthchecks + `restart: unless-stopped` are
  baked into docker-compose.yml.
- Quality gates: `npm run lint`, `npm test`, `npm audit`.
