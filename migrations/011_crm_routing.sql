-- Lane CR: lead routing. Rules assign an owner to new contacts that have none, on contact.created and form.submitted.
CREATE TABLE crm_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  -- 'any' matches every lead; otherwise the contact's country, the event source (or UTM source) or the form id/name.
  match_field text NOT NULL DEFAULT 'any' CHECK (match_field IN ('any', 'country', 'source', 'form')),
  match_value text NOT NULL DEFAULT '',
  user_ids uuid[] NOT NULL DEFAULT '{}',
  -- Round-robin cursor: the next lead goes to user_ids[next_index % length].
  next_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per event that assigned an owner, so a redelivered event never rotates or reassigns twice.
CREATE TABLE crm_routing_log (
  event_id bigint PRIMARY KEY,
  contact_id bigint NOT NULL,
  rule_id uuid REFERENCES crm_routing_rules(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_routing_log_recent ON crm_routing_log (assigned_at DESC);
