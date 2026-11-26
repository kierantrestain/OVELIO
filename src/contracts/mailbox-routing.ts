import type { InboxAssignee } from './mailbox-team';

export type MailboxRoutingSettings = { assigneeId: string | null; assignmentOptions: InboxAssignee[] };
