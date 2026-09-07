ALTER TABLE providers ADD COLUMN IF NOT EXISTS request_shape TEXT NOT NULL DEFAULT 'flat';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS model TEXT;

INSERT INTO providers (name, base_url, api_key_env, priority, enabled, request_shape, model)
VALUES ('groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 50, true, 'openai', 'qwen/qwen3.8-27b')
ON CONFLICT (name) DO NOTHING;