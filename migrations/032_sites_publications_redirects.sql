-- Lane MC · Sites: publish history (rollback republishes a past snapshot) and 301 redirects from old page addresses.

CREATE TABLE page_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  -- 'a' is the page itself (control); 'b'…'h' are A/B variants.
  variant_key text NOT NULL DEFAULT 'a' CHECK (variant_key ~ '^[a-h]$'),
  design_version integer,
  html text NOT NULL,
  css text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_publications_page ON page_publications (page_id, published_at DESC);

-- Existing live snapshots become the first history entry of each page.
INSERT INTO page_publications (page_id, design_version, html, css, label, published_at)
SELECT id, published_version, published_html, published_css, 'Published', coalesce(published_at, now())
FROM landing_pages WHERE published_version IS NOT NULL;

CREATE TABLE page_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL is the workspace address (/s/<slug>).
  domain_id uuid REFERENCES site_domains(id) ON DELETE CASCADE,
  from_slug text NOT NULL CHECK (from_slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  page_id uuid NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  hits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX page_redirects_from ON page_redirects ((coalesce(domain_id::text, '')), from_slug);
CREATE INDEX page_redirects_page ON page_redirects (page_id);
