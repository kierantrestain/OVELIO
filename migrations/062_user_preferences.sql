-- Per-user interface preferences such as the Overview layout and table density (Product Engineering, wave one).
CREATE TABLE user_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
