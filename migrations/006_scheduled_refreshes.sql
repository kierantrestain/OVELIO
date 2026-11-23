-- DEL-22: pre-send segment refresh for scheduled campaigns.
-- One row per scheduled campaign. `run_id` changes whenever the campaign is (re)scheduled, so work started for an
-- older schedule is recognised as stale and stops. `progress` is the resumable cursor for the current run.
CREATE TABLE scheduled_refreshes (
  campaign_id bigint PRIMARY KEY,
  send_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('waiting', 'refreshing', 'held', 'ready', 'late', 'failed', 'missed', 'cancelled')),
  run_id uuid NOT NULL,
  progress jsonb,
  errors integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_refreshes_active ON scheduled_refreshes (send_at) WHERE state IN ('waiting', 'refreshing', 'held');

-- Rows kept while a run pages a segment. 'member' rows: contact_id is the segment member's contact id.
-- 'stale' rows: contact_id is the Listmonk subscriber id of a mirror-list subscriber that must be checked and, if no
-- longer in the segment, taken off the list; mautic_id is its contact id, or NULL when the subscriber has none.
CREATE TABLE scheduled_refresh_contacts (
  run_id uuid NOT NULL,
  segment_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('member', 'stale')),
  contact_id bigint NOT NULL,
  mautic_id bigint,
  PRIMARY KEY (run_id, segment_id, kind, contact_id)
);
