-- Limit the incoming sample by mailbox, using a newest-first index.
CREATE INDEX crm_mailbox_messages_recent_inbound
  ON crm_mailbox_messages (mailbox_id, occurred_at DESC, provider_message_id DESC)
  INCLUDE (thread_id) WHERE direction = 'inbound';

-- The first observed inbound and first following outbound are each a single ordered lookup.
CREATE INDEX crm_mailbox_messages_thread_direction_time
  ON crm_mailbox_messages (mailbox_id, (coalesce(nullif(thread_id, ''), provider_message_id)), direction, occurred_at);
