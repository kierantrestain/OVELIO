export const inboxTeamStatuses = ['open', 'pending', 'resolved'] as const;
export type InboxTeamStatus = typeof inboxTeamStatuses[number];
export const inboxTeamStatusLabels: Record<InboxTeamStatus, string> = { open: 'Open', pending: 'Pending', resolved: 'Resolved' };

export type InboxAssignee = { id: string; name: string };
export type InboxTeamNote = { id: string; authorName: string; body: string; createdAt: string };

export type InboxTeam = {
  status: InboxTeamStatus;
  assignee: InboxAssignee | null;
  canAssign: boolean;
  canChangeStatus: boolean;
  assignmentOptions: InboxAssignee[];
  notes: InboxTeamNote[];
};

export type InboxTeamPatch = { status?: InboxTeamStatus; assigneeId?: string | null };
export type SavedReplyInput = { title: string; body: string };
export type SavedReply = SavedReplyInput & { id: string; updatedAt: string };
