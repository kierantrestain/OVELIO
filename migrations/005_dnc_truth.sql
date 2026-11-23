-- AUD-08 and X-03: OVELIO `suppressions` is the one consent truth; Mautic DNC and the Listmonk blocklist mirror it.

-- A manual do-not-contact reason (Mautic reason 3), and the comment the engines show beside the entry.
ALTER TABLE suppressions DROP CONSTRAINT IF EXISTS suppressions_reason_check;
ALTER TABLE suppressions ADD CONSTRAINT suppressions_reason_check
  CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'erasure', 'manual'));
ALTER TABLE suppressions ADD COLUMN comment text NOT NULL DEFAULT '';

-- Removing a suppression is audited like adding one.
ALTER TABLE consent_events DROP CONSTRAINT IF EXISTS consent_events_action_check;
ALTER TABLE consent_events ADD CONSTRAINT consent_events_action_check
  CHECK (action IN ('opted_in', 'suppressed', 'unsuppressed'));

-- When a suppression was removed. The reconciliation sweep ignores engine entries older than this,
-- so an engine that still shows the old entry cannot undo a removal.
CREATE TABLE suppression_removals (
  email_key text PRIMARY KEY,
  removed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL
);
