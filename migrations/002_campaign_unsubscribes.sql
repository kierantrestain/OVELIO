-- One row per subscriber who used a campaign's unsubscribe link. The primary key keeps repeat clicks from counting twice.
CREATE TABLE campaign_unsubscribes (
  campaign_uuid uuid NOT NULL,
  subscriber_uuid uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('lists', 'everything')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_uuid, subscriber_uuid)
);
