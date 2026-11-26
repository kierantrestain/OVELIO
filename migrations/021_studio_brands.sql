-- Email studio (lane 2 / MC): several brand kits, one default, and the brand each design uses. The single-row
-- studio_brand_kits table from 020 is copied in as the default and no longer read.
CREATE TABLE studio_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kit jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX studio_brands_single_default ON studio_brands (is_default) WHERE is_default;

INSERT INTO studio_brands (name, kit, is_default, updated_by, updated_at)
SELECT coalesce(nullif(kit->>'name', ''), 'Default brand'), kit, true, updated_by, updated_at FROM studio_brand_kits;

ALTER TABLE designs ADD COLUMN brand_id uuid REFERENCES studio_brands(id) ON DELETE SET NULL;
