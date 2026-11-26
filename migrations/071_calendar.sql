-- Internal hosts own availability. Hold their rows in ID order before reserving any
-- appointment so bookings across different booking types cannot overlap.
CREATE TABLE calendar_hosts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  time_zone text NOT NULL DEFAULT 'UTC',
  weekly_windows jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE calendar_booking_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  active boolean NOT NULL DEFAULT true,
  last_host_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_type_hosts (
  booking_type_id uuid NOT NULL REFERENCES calendar_booking_types(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES calendar_hosts(user_id) ON DELETE RESTRICT,
  PRIMARY KEY (booking_type_id, host_id)
);

CREATE TABLE calendar_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type_id uuid NOT NULL REFERENCES calendar_booking_types(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  contact_id bigint NOT NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  title text NOT NULL,
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  guest_name text NOT NULL,
  guest_email text NOT NULL,
  time_zone text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  blocked_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  revision integer NOT NULL DEFAULT 1,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND blocked_until >= ends_at),
  UNIQUE (booking_type_id, request_id)
);
CREATE INDEX calendar_appointments_host_time ON calendar_appointments (host_id, starts_at, blocked_until) WHERE status <> 'cancelled';
CREATE INDEX calendar_appointments_contact ON calendar_appointments (contact_id);
CREATE INDEX calendar_appointments_deal ON calendar_appointments (deal_id) WHERE deal_id IS NOT NULL;

CREATE TABLE calendar_feeds (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE
);
