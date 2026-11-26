-- Platform Engineering (Growth OS wave one): OVELIO's own media store. The bytes live here so uploads survive
-- restarts and are covered by the ovelio database backup. Ids start at 1,000,000,000 so they never collide with the
-- newsletter engine's media ids in the shared media library (/api/console/media).
CREATE TABLE media_files (
  id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000000000) PRIMARY KEY,
  uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 120),
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'image/svg+xml')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_files_recent ON media_files (created_at DESC);
