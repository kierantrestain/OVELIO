-- ANA-05: the tracking-snippet choices saved for each website, so the snippet can be rebuilt exactly.
CREATE TABLE analytics_snippet_preferences (
  website_id uuid PRIMARY KEY,
  options jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ANA-07: ordered channel rules for the workspace. The first rule that matches a visit source wins.
CREATE TABLE analytics_channel_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position integer NOT NULL,
  name text NOT NULL,
  channel text NOT NULL,
  conditions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_channel_rules_position ON analytics_channel_rules (position);

-- ANA-10: API keys for the server-side events API. Only a hash of the key is stored.
CREATE TABLE analytics_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  rate_limit_per_minute integer NOT NULL DEFAULT 120 CHECK (rate_limit_per_minute BETWEEN 1 AND 6000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- ANA-10: idempotency keys already accepted. Rows older than the retention window are deleted when new events arrive.
CREATE TABLE analytics_event_idempotency (
  api_key_id uuid NOT NULL REFERENCES analytics_api_keys(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, idempotency_key)
);
CREATE INDEX analytics_event_idempotency_age ON analytics_event_idempotency (created_at);
