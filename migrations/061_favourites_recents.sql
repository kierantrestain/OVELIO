-- Starred and recently opened records per user (Product Engineering, wave one).
CREATE TABLE user_record_marks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mark text NOT NULL CHECK (mark IN ('star', 'recent')),
  kind text NOT NULL CHECK (kind IN ('deal', 'contact', 'company', 'campaign', 'page', 'flow')),
  record_id text NOT NULL,
  label text NOT NULL,
  href text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mark, kind, record_id)
);
CREATE INDEX user_record_marks_recent ON user_record_marks (user_id, mark, at DESC);
