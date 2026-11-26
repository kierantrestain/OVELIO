-- OVELIO 2.0 platform spine (docs/rebuild/TRACKER.md §2): one identity map, one event stream, shared views, audit.
-- Lane tables live in their own migrations: 010-019 CRM & Sales, 020-029 Email Studio, 030-039 Sites & Forms,
-- 040-049 Campaigns & Automations, 050-059 Analytics.

-- Links outside identifiers (analytics visitor ids, form submission ids, mailbox addresses) to the master contact id.
CREATE TABLE identity_links (
  kind text NOT NULL CHECK (kind IN ('analytics_visitor', 'analytics_session', 'form_submission', 'mailbox_address', 'external')),
  value text NOT NULL,
  contact_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value)
);
CREATE INDEX identity_links_contact ON identity_links (contact_id);

-- The unified event stream every module writes with emitEvent() and automations, attribution and timelines read.
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  contact_id bigint,
  company_id bigint,
  deal_id uuid,
  campaign_id uuid,
  entity_type text,
  entity_id text,
  source text NOT NULL DEFAULT 'ovelio',
  visitor_id text,
  amount numeric(14, 2),
  currency text,
  utm jsonb NOT NULL DEFAULT '{}',
  properties jsonb NOT NULL DEFAULT '{}',
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE
);
CREATE INDEX events_type_time ON events (type, occurred_at DESC);
CREATE INDEX events_contact_time ON events (contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX events_deal_time ON events (deal_id, occurred_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX events_campaign_time ON events (campaign_id, occurred_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX events_entity ON events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX events_visitor ON events (visitor_id) WHERE visitor_id IS NOT NULL;

-- Saved table views (filters, columns, sort) for any list: contacts, companies, deals, tasks, campaigns.
CREATE TABLE saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object text NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '[]',
  columns jsonb NOT NULL DEFAULT '[]',
  sort jsonb,
  shared boolean NOT NULL DEFAULT true,
  owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_views_object ON saved_views (object, lower(name));

-- Who changed what. Modules write it with audit() for creates, deletes, publishes, sends and permission changes.
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_recent ON audit_log (created_at DESC);
