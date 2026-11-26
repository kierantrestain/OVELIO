-- Pending receipts may be retried when a directory write fails or a request stops
-- midway. A lease lets the external directory update run outside a SQL transaction.
ALTER TABLE journey_hook_deliveries ADD COLUMN lease_id uuid;
ALTER TABLE journey_hook_deliveries ADD COLUMN lease_expires_at timestamptz;
