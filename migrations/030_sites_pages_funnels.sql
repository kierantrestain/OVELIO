-- Lane 3 · Sites & Forms (docs/rebuild/TRACKER.md §3): publishing domains, landing pages, A/B variants and funnels.
-- Page designs live in the shared `designs` table (kind 'page'); saved sections use kind 'page_section'.

-- Custom domains and subdomains a workspace publishes pages on. Ownership is proven with a DNS TXT record.
CREATE TABLE site_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL UNIQUE CHECK (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' AND length(hostname) <= 253),
  -- 'subdomain' (go.example.com, routed with a CNAME) or 'custom' (an apex domain such as example.com, routed with an A record).
  kind text NOT NULL CHECK (kind IN ('subdomain', 'custom')),
  verification_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  status_detail text NOT NULL DEFAULT '',
  routing_detail text NOT NULL DEFAULT '',
  checked_at timestamptz,
  verified_at timestamptz,
  home_page_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  -- NULL publishes on the workspace's own address (/s/<slug>).
  domain_id uuid REFERENCES site_domains(id) ON DELETE SET NULL,
  design_id uuid NOT NULL REFERENCES designs(id),
  template_key text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  -- The sanitised snapshot visitors see. Editing the design never changes it until the page is published again.
  published_html text NOT NULL DEFAULT '',
  published_css text NOT NULL DEFAULT '',
  published_version integer,
  published_at timestamptz,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  og_image_url text NOT NULL DEFAULT '',
  canonical_url text NOT NULL DEFAULT '',
  favicon_url text NOT NULL DEFAULT '',
  noindex boolean NOT NULL DEFAULT false,
  -- Applied to tracked visits that arrive without utm_* parameters, e.g. {"source": "linkedin", "campaign": "spring"}.
  utm_defaults jsonb NOT NULL DEFAULT '{}',
  ab_enabled boolean NOT NULL DEFAULT false,
  control_weight integer NOT NULL DEFAULT 50 CHECK (control_weight BETWEEN 0 AND 100),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Slugs are unique per domain; NULL (the workspace address) counts as one domain.
CREATE UNIQUE INDEX landing_pages_domain_slug ON landing_pages ((coalesce(domain_id::text, '')), slug);
CREATE INDEX landing_pages_status ON landing_pages (status, updated_at DESC);

ALTER TABLE site_domains ADD CONSTRAINT site_domains_home_page FOREIGN KEY (home_page_id) REFERENCES landing_pages(id) ON DELETE SET NULL;

-- A/B variants. The page's own design is the control ("A"); each variant has its own design, weight and snapshot.
CREATE TABLE page_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[b-z]$'),
  name text NOT NULL,
  design_id uuid NOT NULL REFERENCES designs(id),
  weight integer NOT NULL DEFAULT 50 CHECK (weight BETWEEN 0 AND 100),
  published_html text NOT NULL DEFAULT '',
  published_css text NOT NULL DEFAULT '',
  published_version integer,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, key)
);

CREATE TABLE funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funnel_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL,
  page_id uuid NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  UNIQUE (funnel_id, position)
);
CREATE INDEX funnel_steps_page ON funnel_steps (page_id);
