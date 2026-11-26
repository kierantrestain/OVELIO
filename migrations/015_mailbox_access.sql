-- Keep mailbox provenance on copies used by CRM and the event bus. A disconnected
-- mailbox's ID must survive on these records so they can never become workspace-visible.
ALTER TABLE activities ADD COLUMN mailbox_id uuid;
ALTER TABLE messages ADD COLUMN mailbox_id uuid;
ALTER TABLE events ADD COLUMN mailbox_id uuid;

CREATE TABLE crm_mailbox_members (
  mailbox_id uuid NOT NULL REFERENCES crm_mailboxes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (mailbox_id, user_id)
);
CREATE INDEX crm_mailbox_members_user ON crm_mailbox_members (user_id, mailbox_id);

UPDATE messages
SET mailbox_id = CASE WHEN source ~* '^mailbox:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                      THEN substring(source from 9)::uuid ELSE gen_random_uuid() END
WHERE source LIKE 'mailbox:%';

UPDATE activities a SET mailbox_id = mm.mailbox_id
FROM crm_mailbox_messages mm WHERE a.id = mm.activity_id;

UPDATE activities a SET mailbox_id = m.mailbox_id
FROM messages m WHERE a.message_id = m.id AND m.mailbox_id IS NOT NULL;

-- Historical sync could leave an orphan activity after a concurrent import or a
-- mailbox deletion. Authorless email entries without provenance stay private.
UPDATE activities SET mailbox_id = gen_random_uuid()
WHERE mailbox_id IS NULL AND type = 'email' AND author_id IS NULL AND message_id IS NULL;

UPDATE events
SET mailbox_id = CASE WHEN entity_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                      THEN entity_id::uuid ELSE gen_random_uuid() END
WHERE entity_type = 'mailbox';

UPDATE events e SET mailbox_id = a.mailbox_id
FROM activities a WHERE e.type = 'activity.logged' AND e.entity_type = 'activity' AND e.entity_id = a.id::text
AND a.mailbox_id IS NOT NULL;

UPDATE events e SET mailbox_id = gen_random_uuid()
WHERE e.mailbox_id IS NULL AND e.type = 'activity.logged' AND e.entity_type = 'activity'
AND e.properties->>'type' = 'email' AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.id::text = e.entity_id);

CREATE INDEX crm_mailbox_messages_activity ON crm_mailbox_messages (activity_id) WHERE activity_id IS NOT NULL;
