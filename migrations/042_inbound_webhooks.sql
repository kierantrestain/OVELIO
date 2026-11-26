-- Inbound webhooks (wave two, connector infrastructure): any system that can POST JSON (n8n, Zapier, Make, Shopify,
-- WooCommerce, a custom app) can create or update a contact and start workflows. Additive only.
CREATE TABLE journey_inbound_hooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Shared secret: sent as a Bearer token, or used as the HMAC-SHA256 key the sender signs the raw body with.
  secret text NOT NULL,
  -- Dot paths into the JSON body, e.g. "customer.email" or "billing.first_name"; arrays by index ("line_items.0.sku").
  email_path text NOT NULL DEFAULT 'email',
  first_name_path text NOT NULL DEFAULT '',
  last_name_path text NOT NULL DEFAULT '',
  amount_path text NOT NULL DEFAULT '',
  currency_path text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  received_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  last_received_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  last_error_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per accepted delivery, keyed by the sender's delivery id (or a hash of the body) so retries count once.
CREATE TABLE journey_hook_deliveries (
  hook_id uuid NOT NULL REFERENCES journey_inbound_hooks(id) ON DELETE CASCADE,
  delivery_key text NOT NULL,
  contact_id bigint,
  outcome text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hook_id, delivery_key)
);
CREATE INDEX journey_hook_deliveries_recent ON journey_hook_deliveries (hook_id, received_at DESC);
