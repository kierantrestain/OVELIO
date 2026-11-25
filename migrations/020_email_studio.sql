-- Email studio (lane 2, docs/rebuild/TRACKER.md §3). Designs and versions live in the shared `designs` and
-- `design_versions` tables (migration 008); this adds the brand kit and the links from a design to the engine records
-- it feeds (a Listmonk newsletter or transactional template, a Mautic journey email).

-- One brand kit per workspace. `kit` holds logo, colours, fonts, footer text and social links (src/contracts/studio.ts).
CREATE TABLE studio_brand_kits (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  kit jsonb NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE studio_design_links (
  engine text NOT NULL CHECK (engine IN ('listmonk_campaign', 'listmonk_template', 'mautic_email')),
  engine_id text NOT NULL,
  design_id uuid NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engine, engine_id)
);
CREATE INDEX studio_design_links_design ON studio_design_links (design_id);

-- Version history newest first, and whether a version was taken automatically (every 10 minutes of edits).
ALTER TABLE design_versions ADD COLUMN automatic boolean NOT NULL DEFAULT false;
CREATE INDEX design_versions_recent ON design_versions (design_id, created_at DESC);
CREATE INDEX messages_design ON messages (design_id, created_at DESC) WHERE design_id IS NOT NULL;
