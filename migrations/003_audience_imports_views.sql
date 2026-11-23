-- Saved contact list views (search + sort), shared by the whole team.
CREATE TABLE contact_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  search text NOT NULL DEFAULT '',
  sort_by text NOT NULL DEFAULT 'createdAt',
  sort_dir text NOT NULL DEFAULT 'desc' CHECK (sort_dir IN ('asc', 'desc')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_views_name ON contact_views (lower(name));

-- One row per contact import. The CSV is kept until the real run finishes, so a dry run and the run can share one upload.
CREATE TABLE contact_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'running', 'done', 'failed')),
  dry_run boolean NOT NULL DEFAULT false,
  csv text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}',
  evidence text,
  update_existing boolean NOT NULL DEFAULT true,
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX contact_imports_recent ON contact_imports (created_at DESC);

-- Rows that were skipped or failed, with the reason; downloadable as CSV.
CREATE TABLE contact_import_issues (
  import_id uuid NOT NULL REFERENCES contact_imports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('skipped', 'error')),
  email text NOT NULL DEFAULT '',
  message text NOT NULL,
  PRIMARY KEY (import_id, row_number)
);
