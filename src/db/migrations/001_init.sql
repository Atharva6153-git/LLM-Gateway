CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_key_env TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS api_clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  bucket_size INT NOT NULL DEFAULT 20,
  refill_rate INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_log (
  id SERIAL PRIMARY KEY,
  client_id INT REFERENCES api_clients(id),
  provider_id INT REFERENCES providers(id),
  status TEXT NOT NULL,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_log_provider ON request_log(provider_id);
CREATE INDEX IF NOT EXISTS idx_request_log_client ON request_log(client_id);

INSERT INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('mock', 'http://mock-provider:4000', 'MOCK_NO_KEY_NEEDED', 200, true)
ON CONFLICT (name) DO NOTHING;
