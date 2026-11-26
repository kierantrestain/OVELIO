CREATE TABLE crm_mailbox_routing (
  mailbox_id uuid PRIMARY KEY REFERENCES crm_mailboxes (id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
