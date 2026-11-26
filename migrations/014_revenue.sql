-- Revenue (wave two, CRM & Revenue lane, docs/rebuild/TRACKER.md §7). Additive only.
-- Catalogue → deal line items → proposals (quotes) with e-signature acceptance → invoices → payments (Stripe Checkout
-- or recorded by hand) → subscriptions for recurring revenue. OVELIO never sees or stores card details: payments are
-- taken on Stripe's hosted Checkout page and confirmed by Stripe's signed webhook.

CREATE TABLE rev_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Percent, e.g. 20.000 for UK standard VAT.
  rate numeric(6, 3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rev_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'service' CHECK (kind IN ('product', 'service')),
  -- Price in the product's own currency; rev_product_prices holds the price list for other currencies.
  unit_price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  billing text NOT NULL DEFAULT 'one_time' CHECK (billing IN ('one_time', 'monthly', 'quarterly', 'yearly')),
  tax_rate_id uuid REFERENCES rev_tax_rates(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX rev_products_sku ON rev_products (lower(sku)) WHERE sku <> '' AND archived_at IS NULL;

CREATE TABLE rev_product_prices (
  product_id uuid NOT NULL REFERENCES rev_products(id) ON DELETE CASCADE,
  currency text NOT NULL,
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (product_id, currency)
);

-- What is being sold on a deal. When a deal has line items its value follows their net total.
CREATE TABLE deal_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id uuid REFERENCES rev_products(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  tax_rate numeric(6, 3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  billing text NOT NULL DEFAULT 'one_time' CHECK (billing IN ('one_time', 'monthly', 'quarterly', 'yearly')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_line_items_deal ON deal_line_items (deal_id, position);

CREATE SEQUENCE rev_quote_number START 1001;
CREATE SEQUENCE rev_invoice_number START 1001;

-- Proposals and quotations. `lines` is the frozen commercial content once sent; acceptance signs a hash of it.
CREATE TABLE rev_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_id bigint,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  title text NOT NULL,
  intro text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'GBP',
  lines jsonb NOT NULL DEFAULT '[]',
  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  discount_total numeric(14, 2) NOT NULL DEFAULT 0,
  tax_total numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  -- Net value per month of the recurring lines (quarterly and yearly lines normalised to a month).
  monthly_recurring numeric(14, 2) NOT NULL DEFAULT 0,
  -- Share of the first invoice due on acceptance; 100 = pay in full.
  deposit_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  valid_until date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'void')),
  -- Unguessable public link token (24 random bytes, base64url): /proposal/<token>.
  token text UNIQUE,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text NOT NULL DEFAULT '',
  signer_name text NOT NULL DEFAULT '',
  signer_email text NOT NULL DEFAULT '',
  signer_ip_hash text NOT NULL DEFAULT '',
  signer_agent text NOT NULL DEFAULT '',
  document_hash text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rev_quotes_deal ON rev_quotes (deal_id, created_at DESC);
CREATE INDEX rev_quotes_status ON rev_quotes (status, updated_at DESC);

CREATE TABLE rev_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  quote_id uuid REFERENCES rev_quotes(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  subscription_id uuid,
  contact_id bigint,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'deposit', 'balance', 'recurring', 'manual')),
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'GBP',
  lines jsonb NOT NULL DEFAULT '[]',
  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  tax_total numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid numeric(14, 2) NOT NULL DEFAULT 0,
  amount_refunded numeric(14, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'paid', 'void')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  paid_at timestamptz,
  -- Unguessable public link token: /pay/<token>.
  token text UNIQUE,
  stripe_session_id text UNIQUE,
  stripe_payment_intent text,
  payment_url text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rev_invoices_status ON rev_invoices (status, issued_at DESC);
CREATE INDEX rev_invoices_deal ON rev_invoices (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX rev_invoices_intent ON rev_invoices (stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;

CREATE TABLE rev_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES rev_invoices(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'manual')),
  -- Stripe payment intent id, or a generated id for a manual payment. Unique, so a webhook retry records once.
  provider_ref text NOT NULL UNIQUE,
  method text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  refunded numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  note text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX rev_payments_received ON rev_payments (received_at DESC);

CREATE TABLE rev_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES rev_payments(id) ON DELETE CASCADE,
  provider_ref text NOT NULL UNIQUE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL DEFAULT '',
  refunded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Recurring revenue created when a proposal with recurring lines is accepted. The worker issues each period's
-- invoice ('revenue.renew' job) until the subscription is cancelled.
CREATE TABLE rev_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid REFERENCES rev_quotes(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_id bigint,
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  name text NOT NULL,
  currency text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'yearly')),
  lines jsonb NOT NULL DEFAULT '[]',
  -- Gross amount per interval (incl. tax) and its net value per month.
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  monthly_value numeric(14, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  next_invoice_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rev_subscriptions_due ON rev_subscriptions (next_invoice_at) WHERE status = 'active';

-- Stripe webhook deliveries, keyed by Stripe's event id so a redelivery is processed once.
CREATE TABLE rev_stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text NOT NULL DEFAULT ''
);
