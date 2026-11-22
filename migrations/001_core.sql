CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'marketer', 'analyst')),
  password_hash text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description text NOT NULL,
  href text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_state (
  contact_id bigint PRIMARY KEY,
  email_key text NOT NULL UNIQUE,
  subscriber_id bigint UNIQUE,
  consent text NOT NULL DEFAULT 'unknown' CHECK (consent IN ('unknown', 'opted_in', 'suppressed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id bigint NOT NULL,
  email_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('opted_in', 'suppressed')),
  evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_events_contact ON consent_events (contact_id, created_at DESC);

CREATE TABLE suppressions (
  email_key text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'erasure')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE segment_lists (
  segment_id bigint PRIMARY KEY,
  list_id bigint NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_operations (
  campaign_id bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('start', 'schedule', 'pause')),
  reference text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, operation, reference)
);

CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'working', 'done', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_id uuid,
  generation integer NOT NULL DEFAULT 0,
  finished_at timestamptz,
  last_error text
);
CREATE UNIQUE INDEX jobs_active_key ON jobs (dedupe_key) WHERE status IN ('pending', 'working');
CREATE INDEX jobs_ready ON jobs (run_at, id) WHERE status IN ('pending', 'working');
