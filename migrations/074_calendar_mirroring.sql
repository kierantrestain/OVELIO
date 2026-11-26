-- Write consent is separate from availability. The target identifies the calendar account,
-- while the connection revision changes whenever that account reconnects.
ALTER TABLE calendar_connections ADD COLUMN mirror_target text;
ALTER TABLE calendar_oauth_requests ADD COLUMN mirror_requested boolean NOT NULL DEFAULT false;

CREATE TABLE calendar_event_mirrors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES calendar_appointments(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  target text NOT NULL,
  remote_id text,
  applied_revision integer,
  UNIQUE (appointment_id, host_id, provider, target)
);
