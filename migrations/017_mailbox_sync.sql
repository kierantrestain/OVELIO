CREATE TABLE crm_mailbox_sync_state (
  mailbox_id uuid PRIMARY KEY REFERENCES crm_mailboxes (id) ON DELETE CASCADE,
  cursor jsonb NOT NULL DEFAULT '{}',
  lease_token uuid,
  lease_until timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
