-- OVELIO 2.0 shared records (lead-owned, docs/rebuild/TRACKER.md §3). Lanes extend these with additive migrations
-- in their own number range; they never edit this file once merged.

-- Marketing campaigns: the hub that groups emails, pages, forms, flows and segments, and that leads, deals and
-- revenue are attributed to. `utm_campaign` is the slug that links tracked visits to the campaign.
CREATE TABLE marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  objective text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'archived')),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  starts_on date,
  ends_on date,
  budget numeric(14, 2) CHECK (budget IS NULL OR budget >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  utm_campaign text NOT NULL UNIQUE CHECK (utm_campaign ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  utm_source text NOT NULL DEFAULT '',
  utm_medium text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE campaign_assets (
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('design', 'newsletter', 'journey_email', 'page', 'funnel', 'form', 'flow', 'journey', 'segment', 'list', 'link')),
  asset_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, asset_type, asset_id)
);
CREATE INDEX campaign_assets_asset ON campaign_assets (asset_type, asset_id);

-- Sales pipelines. A stage's outcome marks it as the won or lost column; probability drives the weighted forecast.
CREATE TABLE pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  position integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pipelines_single_default ON pipelines (is_default) WHERE is_default;

CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
  rotting_days integer CHECK (rotting_days IS NULL OR rotting_days > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pipeline_stages_order ON pipeline_stages (pipeline_id, position);

-- Deals. contact_id and company_id are the primary associations (Mautic ids); the *_name/_email columns are display
-- snapshots refreshed when the association changes, so boards render without an engine call per card.
CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id),
  stage_id uuid NOT NULL REFERENCES pipeline_stages(id),
  name text NOT NULL,
  amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  -- NULL means "use the stage's probability".
  probability integer CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_id bigint,
  company_id bigint,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT '',
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text NOT NULL DEFAULT '',
  board_position double precision NOT NULL DEFAULT 0,
  custom jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX deals_board ON deals (pipeline_id, stage_id, board_position) WHERE archived_at IS NULL;
CREATE INDEX deals_contact ON deals (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX deals_company ON deals (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX deals_owner ON deals (owner_id);
CREATE INDEX deals_campaign ON deals (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX deals_closed ON deals (status, closed_at);

-- Further people on a deal (one contact or company can have many deals; one deal many people).
CREATE TABLE deal_contacts (
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id bigint NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  PRIMARY KEY (deal_id, contact_id)
);
CREATE INDEX deal_contacts_contact ON deal_contacts (contact_id);

CREATE TABLE deal_stage_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id uuid,
  to_stage_id uuid NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_history_deal ON deal_stage_history (deal_id, changed_at DESC);

-- Tasks, reminders and follow-ups for people, companies and deals.
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'todo' CHECK (type IN ('todo', 'call', 'email', 'meeting', 'follow_up')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_at timestamptz,
  remind_at timestamptz,
  completed_at timestamptz,
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_id bigint,
  company_id bigint,
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  -- 'manual', 'flow:<id>' or 'sequence:<id>'
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_assignee_due ON tasks (assignee_id, status, due_at);
CREATE INDEX tasks_contact ON tasks (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX tasks_deal ON tasks (deal_id) WHERE deal_id IS NOT NULL;

-- Communication history: notes, calls, meetings and logged or sent emails.
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('note', 'call', 'meeting', 'email', 'other')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  direction text CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  outcome text NOT NULL DEFAULT '',
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  contact_id bigint,
  company_id bigint,
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  message_id uuid,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_contact ON activities (contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX activities_company ON activities (company_id, occurred_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX activities_deal ON activities (deal_id, occurred_at DESC) WHERE deal_id IS NOT NULL;

-- Record ownership for contacts and companies (Mautic ids). Deals carry owner_id themselves.
CREATE TABLE record_owners (
  object text NOT NULL CHECK (object IN ('contact', 'company')),
  record_id bigint NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object, record_id)
);
CREATE INDEX record_owners_owner ON record_owners (owner_id, object);

-- Visual designs: emails, landing pages and their reusable blocks. `document` is the editor's project data, `source`
-- the MJML (email) or HTML (page) it produces, `html` the compiled, sanitised output that is sent or published.
-- Merge tags in `html` use the OVELIO syntax ({{contact.first_name}}, {{unsubscribe_url}}; src/contracts/merge-tags.ts).
CREATE TABLE designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('email', 'page', 'email_block', 'page_section')),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  preheader text NOT NULL DEFAULT '',
  document jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT '',
  html text NOT NULL DEFAULT '',
  css text NOT NULL DEFAULT '',
  template_key text,
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX designs_kind ON designs (kind, status, updated_at DESC);

CREATE TABLE design_versions (
  design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  version integer NOT NULL,
  label text NOT NULL DEFAULT '',
  document jsonb NOT NULL,
  source text NOT NULL,
  html text NOT NULL,
  css text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (design_id, version)
);

-- Every email OVELIO sends itself (sales, sequences, automations, studio test sends), with the exact rendered HTML.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('marketing', 'sales', 'transactional', 'test')),
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'blocked', 'not_sent')),
  status_reason text NOT NULL DEFAULT '',
  to_email text NOT NULL,
  contact_id bigint,
  from_email text NOT NULL,
  from_name text NOT NULL DEFAULT '',
  reply_to text NOT NULL DEFAULT '',
  subject text NOT NULL,
  html text NOT NULL,
  text_body text NOT NULL DEFAULT '',
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  design_id uuid REFERENCES designs(id) ON DELETE SET NULL,
  -- e.g. 'flow:<id>', 'sequence:<id>', 'studio:test', 'sales:<user id>'
  source text NOT NULL,
  provider_message_id text,
  idempotency_key text UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX messages_contact ON messages (contact_id, created_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX messages_campaign ON messages (campaign_id, created_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX messages_recent ON messages (created_at DESC);

-- A standard sales process so a new workspace can create deals immediately. Rename or replace it in Sales › Pipelines.
WITH pipeline AS (
  INSERT INTO pipelines (name, is_default, position) VALUES ('Sales pipeline', true, 0) RETURNING id
)
INSERT INTO pipeline_stages (pipeline_id, name, position, probability, outcome)
SELECT pipeline.id, stage.name, stage.position, stage.probability, stage.outcome
FROM pipeline, (VALUES
  ('Lead in', 0, 10, 'open'), ('Qualified', 1, 25, 'open'), ('Proposal', 2, 50, 'open'),
  ('Negotiation', 3, 75, 'open'), ('Won', 4, 100, 'won'), ('Lost', 5, 0, 'lost')
) AS stage(name, position, probability, outcome);
