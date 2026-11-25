-- Lane 4: additive columns for the campaign hub on the shared campaign tables (migration 008).
ALTER TABLE marketing_campaigns ADD COLUMN launched_at timestamptz;
-- Per-asset details, e.g. a tracked link's destination and UTM parameters.
ALTER TABLE campaign_assets ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';
CREATE INDEX marketing_campaigns_dates ON marketing_campaigns (starts_on, ends_on);
