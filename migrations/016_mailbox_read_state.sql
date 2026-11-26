-- Provider timestamps can arrive out of order during backfill. Marking a
-- conversation read acknowledges the inbound rows that the viewer saw.
ALTER TABLE crm_mailbox_messages ADD COLUMN ingest_order bigint GENERATED ALWAYS AS IDENTITY;

CREATE TABLE crm_mailbox_thread_reads (
  mailbox_id uuid NOT NULL REFERENCES crm_mailboxes(id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_through bigint NOT NULL CHECK (read_through >= 0),
  PRIMARY KEY (mailbox_id, thread_key, user_id)
);

CREATE INDEX crm_mailbox_thread_reads_user ON crm_mailbox_thread_reads (user_id);
CREATE INDEX messages_mailbox_provider ON messages (mailbox_id, provider_message_id)
  WHERE mailbox_id IS NOT NULL AND provider_message_id IS NOT NULL;
