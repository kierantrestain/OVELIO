/** The interpolated arguments are SQL expressions from callers, never request data. */
export function activeMailboxUser(userAlias: string) {
  return `${userAlias}.disabled_at IS NULL AND ${userAlias}.role IN ('marketer', 'admin')`;
}

/** Ownership and membership are checked against current database state. Workspace role alone grants no mailbox access. */
export function canReadMailbox(mailboxId: string, viewer: string, ownerOnly = false) {
  const access = ownerOnly ? 'mailbox.user_id = viewer.id' : `(mailbox.user_id = viewer.id OR EXISTS (
    SELECT 1 FROM crm_mailbox_members member WHERE member.mailbox_id = mailbox.id AND member.user_id = viewer.id
  ))`;
  return `EXISTS (
    SELECT 1 FROM crm_mailboxes mailbox
    JOIN users owner ON owner.id = mailbox.user_id AND ${activeMailboxUser('owner')}
    JOIN users viewer ON viewer.id = ${viewer} AND ${activeMailboxUser('viewer')}
    WHERE mailbox.id = ${mailboxId} AND mailbox.status <> 'revoked' AND ${access}
  )`;
}

/** Shared CRM data has no mailbox ID. Restricted records are private even after the original mailbox is removed. */
export function mailboxRecordVisible(mailboxId: string, viewer: string) {
  return `(${mailboxId} IS NULL OR ${canReadMailbox(mailboxId, viewer)})`;
}
