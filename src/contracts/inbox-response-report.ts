export const inboxResponseWindows = ['7', '30', '90'] as const;
export type InboxResponseWindow = typeof inboxResponseWindows[number];

export type InboxResponseReport = {
  from: string;
  through: string;
  conversations: number;
  replied: number;
  awaitingFirstReply: number;
  resolvedWithoutReply: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
  sampleLimited: boolean;
  messageLimit: number;
};
