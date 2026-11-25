-- Lane 4 (Campaigns & Automations): OVELIO's native flow engine (docs/rebuild/TRACKER.md D6).
-- A flow is edited as a draft graph and published as an immutable version; enrolments stay on the version they
-- entered, and every step they take is written to the step log. Steps run as platform jobs ('journeys.step').

CREATE TABLE journey_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  -- The draft being edited. The published copy lives in journey_flow_versions.
  triggers jsonb NOT NULL DEFAULT '[]',
  reentry text NOT NULL DEFAULT 'once' CHECK (reentry IN ('once', 'every_time')),
  graph jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}',
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  published_version integer,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  template_key text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  paused_at timestamptz,
  archived_at timestamptz
);
CREATE INDEX journey_flows_status ON journey_flows (status, updated_at DESC);
CREATE INDEX journey_flows_campaign ON journey_flows (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE journey_flow_versions (
  flow_id uuid NOT NULL REFERENCES journey_flows(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  graph jsonb NOT NULL,
  triggers jsonb NOT NULL,
  reentry text NOT NULL CHECK (reentry IN ('once', 'every_time')),
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id, version)
);
-- Trigger matching reads the published version's triggers with jsonb containment.
CREATE INDEX journey_flow_versions_triggers ON journey_flow_versions USING gin (triggers jsonb_path_ops);

CREATE TABLE journey_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES journey_flows(id) ON DELETE CASCADE,
  version integer NOT NULL,
  contact_id bigint,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waiting', 'completed', 'failed', 'exited')),
  current_node text,
  -- Increases with every step taken; a step job carries the value it was scheduled for, so a stale or repeated job is ignored.
  step_seq integer NOT NULL DEFAULT 0,
  trigger_type text NOT NULL,
  trigger_event_id bigint REFERENCES events(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  -- 'once:<flow>:<contact>' for once-only flows, so a contact can never enter twice even under concurrent events.
  entry_key text NOT NULL UNIQUE,
  held_at timestamptz,
  next_run_at timestamptz,
  error text NOT NULL DEFAULT '',
  enrolled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- The same event never enrols the same contact in the same flow twice.
CREATE UNIQUE INDEX journey_enrolments_event ON journey_enrolments (flow_id, trigger_event_id, coalesce(contact_id, 0)) WHERE trigger_event_id IS NOT NULL;
CREATE INDEX journey_enrolments_flow ON journey_enrolments (flow_id, status, enrolled_at DESC);
CREATE INDEX journey_enrolments_contact ON journey_enrolments (contact_id, enrolled_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX journey_enrolments_recent ON journey_enrolments (updated_at DESC);

CREATE TABLE journey_step_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrolment_id uuid NOT NULL REFERENCES journey_enrolments(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  action text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped', 'waiting')),
  detail text NOT NULL DEFAULT '',
  attempt integer NOT NULL DEFAULT 1,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_step_logs_enrolment ON journey_step_logs (enrolment_id, id);
