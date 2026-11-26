-- Calendar availability uses its own consent scopes and credentials, independent of mailbox access.
CREATE TABLE calendar_connections (
  user_id uuid NOT NULL REFERENCES calendar_hosts(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  calendar_ref text NOT NULL,
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  health text NOT NULL DEFAULT 'connected' CHECK (health IN ('connected', 'unavailable')),
  PRIMARY KEY (user_id, provider)
);

-- One outstanding authorization per provider and calendar owner, bound to the login
-- session that initiated it. A claimed request can only complete once.
CREATE TABLE calendar_oauth_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  state_hash text NOT NULL UNIQUE,
  session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, provider)
);
CREATE INDEX calendar_oauth_requests_session ON calendar_oauth_requests (session_hash);
