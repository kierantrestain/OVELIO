-- Lane 1 (CRM & Sales), docs/rebuild/TRACKER.md §3. Additive only: task reminders, sales sequences and connected
-- mailboxes. Deals, pipelines, tasks and activities are the shared tables in 008_core_records.sql.

-- Task reminders: the 'crm.task_reminder' job stamps reminded_at at remind_at; the task then shows under
-- "Due reminders" until it is completed or the reminder is dismissed.
ALTER TABLE tasks ADD COLUMN reminded_at timestamptz;
ALTER TABLE tasks ADD COLUMN reminder_dismissed_at timestamptz;
CREATE INDEX tasks_due_reminders ON tasks (assignee_id, reminded_at) WHERE status = 'open' AND reminded_at IS NOT NULL;

-- Sales sequences: timed emails and tasks for one contact at a time, stopped by a reply, an unsubscribe, a bounce or
-- a won deal.
CREATE TABLE crm_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email', 'task')),
  -- Days after the previous step (or after enrolment, for the first step).
  delay_days integer NOT NULL DEFAULT 0 CHECK (delay_days BETWEEN 0 AND 365),
  -- Moves the send to the next weekday 09:00-17:00 UTC.
  business_hours boolean NOT NULL DEFAULT false,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  task_title text NOT NULL DEFAULT '',
  task_type text NOT NULL DEFAULT 'todo' CHECK (task_type IN ('todo', 'call', 'email', 'meeting', 'follow_up')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, position)
);

CREATE TABLE crm_sequence_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  contact_id bigint NOT NULL,
  contact_email text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  -- Position of the next step to run.
  next_position integer NOT NULL DEFAULT 0,
  next_run_at timestamptz,
  stopped_reason text NOT NULL DEFAULT '',
  -- The user the emails are sent for (reply-to) and tasks are assigned to.
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX crm_enrolments_one_active ON crm_sequence_enrolments (sequence_id, contact_id) WHERE status = 'active';
CREATE INDEX crm_enrolments_contact ON crm_sequence_enrolments (contact_id, status);
CREATE INDEX crm_enrolments_sequence ON crm_sequence_enrolments (sequence_id, enrolled_at DESC);

CREATE TABLE crm_sequence_step_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES crm_sequence_enrolments(id) ON DELETE CASCADE,
  step_id uuid,
  position integer NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'blocked', 'not_sent', 'failed', 'task_created', 'skipped')),
  reason text NOT NULL DEFAULT '',
  message_id uuid,
  task_id uuid,
  ran_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrolment_id, position)
);

-- Connected Gmail and Outlook mailboxes. Tokens are AES-256-GCM encrypted with MAILBOX_ENCRYPTION_KEY.
CREATE TABLE crm_mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  email text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  last_error text NOT NULL DEFAULT '',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, email)
);
CREATE INDEX crm_mailboxes_user ON crm_mailboxes (user_id);

-- One-time OAuth state with the PKCE verifier; consumed by the callback, expired after 15 minutes.
CREATE TABLE crm_mailbox_oauth_states (
  state text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Messages seen in (or sent from) a connected mailbox, so sync is idempotent and replies can be matched to threads.
CREATE TABLE crm_mailbox_messages (
  mailbox_id uuid NOT NULL REFERENCES crm_mailboxes(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  thread_id text NOT NULL DEFAULT '',
  contact_id bigint,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  subject text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  to_emails text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  activity_id uuid,
  PRIMARY KEY (mailbox_id, provider_message_id)
);
CREATE INDEX crm_mailbox_messages_thread ON crm_mailbox_messages (mailbox_id, thread_id);
CREATE INDEX crm_mailbox_messages_contact ON crm_mailbox_messages (contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;
