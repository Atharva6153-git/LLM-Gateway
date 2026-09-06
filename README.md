# llm-gateway

AI Request Gateway — routes requests across LLM providers with automatic
failover (circuit breaker) and per-client rate limiting. See `docs/prd-llm-gateway.md`
for the full spec and open decisions.

## Run locally

```
cp .env.example .env
docker compose up --build
```

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

Check `/metrics` to see circuit state and request counts.
