CREATE INDEX crm_mailbox_messages_thread_key
  ON crm_mailbox_messages (mailbox_id, (coalesce(nullif(thread_id, ''), provider_message_id)));

CREATE TABLE crm_mailbox_thread_team (
  mailbox_id uuid NOT NULL REFERENCES crm_mailboxes (id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
  assignee_id uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox_id, thread_key)
);

CREATE TABLE crm_mailbox_thread_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id uuid NOT NULL REFERENCES crm_mailboxes (id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  author_id uuid REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_mailbox_thread_notes_recent ON crm_mailbox_thread_notes (mailbox_id, thread_key, created_at DESC, id DESC);

CREATE TABLE crm_mailbox_saved_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_mailbox_saved_replies_user ON crm_mailbox_saved_replies (user_id, lower(title), id);
