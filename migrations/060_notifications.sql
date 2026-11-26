-- In-app notifications (Product Engineering, wave one). One row per recipient; dedupe_key makes producers idempotent.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_recent ON notifications (user_id, created_at DESC);
