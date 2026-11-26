// Lane 1 (CRM & Sales) API contracts. Console endpoints live under /api/console/{sales,crm,mailboxes}/
// (src/server/crm/). Contacts and companies are Mautic records (ids are numbers); deals, tasks, activities,
// sequences and mailboxes are OVELIO records (uuid ids).

import type { Consent } from './audience';
import type { DirectoryContact, PlatformEvent } from './platform';

export type StageOutcome = 'open' | 'won' | 'lost';
export type DealStatus = 'open' | 'won' | 'lost';

export type PipelineStage = {
  id: string;
  name: string;
  position: number;
  /** Default win probability for deals in this stage (0-100). Drives the weighted forecast. */
  probability: number;
  outcome: StageOutcome;
  rottingDays: number | null;
  /** Fields a deal needs before entering this stage: 'amount', 'expected_close_date', 'contact', 'company'. */
  requiredFields?: StageRequirement[];
};

/** Cross-lane contract: GET /api/console/sales/pipelines → { items: Pipeline[] } (TRACKER §3). */
export type Pipeline = {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  stages: PipelineStage[];
  archived?: boolean;
  openDeals?: number;
};

export type TeamMember = { id: string; name: string; email: string };

export type StageRequirement = 'amount' | 'expected_close_date' | 'contact' | 'company';
export const stageRequirementLabels: Record<StageRequirement, string> = {
  amount: 'a deal value', expected_close_date: 'an expected close date', contact: 'a contact', company: 'a company',
};

export type Deal = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  stageOutcome: StageOutcome;
  name: string;
  amount: number;
  currency: string;
  /** Override on the deal; null uses the stage probability. */
  probability: number | null;
  effectiveProbability: number;
  /** amount × effective probability. An estimate, never revenue. */
  weightedAmount: number;
  status: DealStatus;
  ownerId: string | null;
  ownerName: string;
  contactId: number | null;
  contactName: string;
  contactEmail: string;
  companyId: number | null;
  companyName: string;
  campaignId: string | null;
  campaignName: string;
  /** '', 'manual', 'flow:<id>', 'form:<id>', 'sequence:<id>', 'preview-seed' … */
  source: string;
  /** Human label for the source, e.g. "Workflow", "Form", "Sample data". */
  sourceLabel: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string;
  boardPosition: number;
  daysInStage: number;
  /** Open deal whose expected close date has passed. */
  overdue: boolean;
  /** Open deal that has sat in its stage longer than the stage's rotting days. */
  rotting: boolean;
  openTasks: number;
  /** Latest logged activity on the deal or with its primary contact. */
  lastActivityAt: string | null;
  /** Earliest open task on the deal. */
  nextTask: { title: string; dueAt: string | null } | null;
  /** 'at_risk' when the deal is stalled beyond its stage's rotting days, past its close date, or quiet for 14 days. */
  health: 'healthy' | 'at_risk' | 'closed';
  healthReasons: string[];
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DealStatusFilter = 'open' | 'won' | 'lost' | 'all';

export type DealFilters = {
  pipelineId?: string;
  ownerId?: string;
  status?: DealStatusFilter;
  q?: string;
  closeFrom?: string;
  closeTo?: string;
  minAmount?: number;
  maxAmount?: number;
  campaignId?: string;
  stageId?: string;
  contactId?: number;
  companyId?: number;
};

export type BoardColumn = { stage: PipelineStage; deals: Deal[]; count: number; total: number; weighted: number };

export type DealBoard = {
  pipeline: Pipeline;
  columns: BoardColumn[];
  totals: { count: number; total: number; weighted: number };
};

export type DealSortKey = 'name' | 'amount' | 'stage' | 'owner' | 'expectedCloseDate' | 'createdAt' | 'updatedAt' | 'probability' | 'company';

export type DealPage = { items: Deal[]; total: number; page: number; limit: number };

export type DealInput = {
  name: string;
  amount?: number;
  currency?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string | null;
  contactId?: number | null;
  companyId?: number | null;
  campaignId?: string | null;
  expectedCloseDate?: string | null;
  probability?: number | null;
};

export type DealPatch = Partial<Omit<DealInput, 'pipelineId' | 'stageId'>> & { custom?: Record<string, unknown>; lostReason?: string };

/** Board drag result: the deal lands in `stageId` between `previousId` (above) and `nextId` (below). */
export type DealMove = { stageId: string; previousId?: string | null; nextId?: string | null; lostReason?: string };

export type DealBulkInput = { ids: string[]; ownerId?: string | null; stageId?: string; status?: 'won' | 'lost' | 'open'; lostReason?: string; archive?: boolean };

export type DealPerson = { contactId: number; name: string; email: string; role: string; primary: boolean };

export type StageChange = {
  id: string;
  fromStageId: string | null;
  fromStageName: string;
  toStageId: string;
  toStageName: string;
  changedById: string | null;
  changedByName: string;
  changedAt: string;
};

export type ActivityType = 'note' | 'call' | 'meeting' | 'email' | 'other';

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string;
  direction: 'inbound' | 'outbound' | null;
  outcome: string;
  durationMinutes: number | null;
  occurredAt: string;
  contactId: number | null;
  companyId: number | null;
  dealId: string | null;
  dealName: string;
  authorId: string | null;
  authorName: string;
  messageId: string | null;
};

export type ActivityInput = {
  type: ActivityType;
  subject?: string;
  body?: string;
  direction?: 'inbound' | 'outbound' | null;
  outcome?: string;
  durationMinutes?: number | null;
  occurredAt?: string;
  contactId?: number | null;
  companyId?: number | null;
  dealId?: string | null;
};

export type TaskType = 'todo' | 'call' | 'email' | 'meeting' | 'follow_up';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskStatus = 'open' | 'done' | 'cancelled';
export type TaskView = 'mine' | 'today' | 'overdue' | 'upcoming' | 'completed' | 'all' | 'reminders';

export type CrmTask = {
  id: string;
  title: string;
  notes: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  remindAt: string | null;
  remindedAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  assigneeName: string;
  contactId: number | null;
  contactName: string;
  companyId: number | null;
  companyName: string;
  dealId: string | null;
  dealName: string;
  source: string;
  overdue: boolean;
  createdAt: string;
};

export type TaskInput = {
  title: string;
  notes?: string;
  type?: TaskType;
  priority?: TaskPriority;
  dueAt?: string | null;
  remindAt?: string | null;
  assigneeId?: string | null;
  contactId?: number | null;
  companyId?: number | null;
  dealId?: string | null;
};

export type TaskPage = { items: CrmTask[]; total: number; counts: Record<TaskView, number> };

export type MessageSummary = {
  id: string;
  subject: string;
  toEmail: string;
  fromEmail: string;
  status: 'sent' | 'failed' | 'blocked' | 'not_sent';
  statusReason: string;
  category: string;
  source: string;
  createdAt: string;
};

export type TimelineKind = 'activity' | 'event' | 'message' | 'engine' | 'stage';

export type TimelineItem = {
  id: string;
  kind: TimelineKind;
  type: string;
  at: string;
  title: string;
  detail?: string;
  actor?: string;
  href?: string;
  tone?: 'neutral' | 'success' | 'info' | 'warning' | 'error';
};

export type DealDetail = {
  deal: Deal;
  pipeline: Pipeline;
  people: DealPerson[];
  activities: Activity[];
  tasks: CrmTask[];
  history: StageChange[];
  messages: MessageSummary[];
  timeline: TimelineItem[];
};

/* ── Contacts and companies ───────────────────────────────────────────── */

export type CrmContact = DirectoryContact & {
  stageId: number | null;
  updatedAt: string | null;
  ownerId: string | null;
  ownerName: string;
  openDeals: number;
  openDealValue: number;
  lastActivityAt: string | null;
};

/** `note` explains a filtered list that was computed from a capped scan of the audience engine. */
export type CrmContactPage = { items: CrmContact[]; total: number; page: number; limit: number; note?: string };

export type CrmContactSort = 'createdAt' | 'updatedAt' | 'lastName' | 'email' | 'points' | 'lastActivity' | 'openDealValue';

export type ContactProfile = {
  contactId: number;
  owner: TeamMember | null;
  deals: Deal[];
  tasks: CrmTask[];
  activities: Activity[];
  messages: MessageSummary[];
  events: PlatformEvent[];
  enrolments: SequenceEnrolment[];
  timeline: TimelineItem[];
  consent: Consent;
};

export type CrmCompany = {
  id: number;
  name: string;
  website: string;
  industry: string;
  city: string;
  country: string;
  email: string;
  ownerId: string | null;
  ownerName: string;
  people: number;
  openDeals: number;
  openValue: number;
  wonRevenue: number;
  currency: string;
  lastActivityAt?: string | null;
};

export type CrmCompanyPage = { items: CrmCompany[]; total: number; page: number; limit: number };

export type CompanyProfile = {
  company: CrmCompany;
  people: DirectoryContact[];
  deals: Deal[];
  tasks: CrmTask[];
  activities: Activity[];
  timeline: TimelineItem[];
};

export type OwnerAssignment = { object: 'contact' | 'company'; ids: number[]; ownerId: string | null };

export type SalesEmailInput = {
  subject: string;
  body: string;
  /** 'gateway' sends through OVELIO's mailer; a mailbox id sends from that connected Gmail or Outlook account. */
  via?: 'gateway' | string;
  dealId?: string | null;
};

export type SalesEmailResult = { status: 'sent' | 'failed' | 'blocked' | 'not_sent'; reason: string; messageId: string | null; via: string };

/* ── Forecast ─────────────────────────────────────────────────────────── */

export type ForecastRow = {
  key: string;
  label: string;
  /** Σ amount × probability for open deals closing in the bucket. Estimate. */
  weighted: number;
  /** Σ amount for open deals closing in the bucket. */
  bestCase: number;
  /** Σ amount for open deals at or above the commit threshold. */
  committed: number;
  /** Σ amount for deals won in the bucket. Measured. */
  closedWon: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
};

export type Forecast = {
  currency: string;
  currencies: string[];
  from: string;
  to: string;
  threshold: number;
  pipelineId: string | null;
  months: ForecastRow[];
  owners: ForecastRow[];
  totals: ForecastRow & {
    /** won ÷ (won + lost) for deals closed in the period; null when nothing closed. */
    winRate: number | null;
    averageDealSize: number | null;
    averageCycleDays: number | null;
  };
};

/* ── Sequences ────────────────────────────────────────────────────────── */

export type SequenceStepKind = 'email' | 'task';

export type SequenceStep = {
  id?: string;
  position: number;
  kind: SequenceStepKind;
  delayDays: number;
  businessHours: boolean;
  subject: string;
  body: string;
  taskTitle: string;
  taskType: TaskType;
};

export type SequenceStatus = 'active' | 'paused' | 'archived';

export type Sequence = {
  id: string;
  name: string;
  description: string;
  status: SequenceStatus;
  steps: SequenceStep[];
  counts: { active: number; completed: number; stopped: number };
  /** Email steps marked "send window only" wait for these hours and weekdays (0 = Sunday) in the recipient's time zone. */
  sendWindow: { start: number; end: number; days: number[] };
  /** Most sequence emails one sender may send per day (UTC); further steps wait for the next day's window. */
  dailyLimit: number;
  createdAt: string;
  updatedAt: string;
};

export type SequenceInput = { name: string; description?: string; status?: SequenceStatus; steps: Omit<SequenceStep, 'id' | 'position'>[]; sendWindow?: Sequence['sendWindow']; dailyLimit?: number };

export type StepRunStatus = 'sent' | 'blocked' | 'not_sent' | 'failed' | 'task_created' | 'skipped';

export type StepRun = { position: number; kind: SequenceStepKind; status: StepRunStatus; reason: string; messageId: string | null; taskId: string | null; ranAt: string };

export type EnrolmentStatus = 'active' | 'completed' | 'stopped';

export type SequenceEnrolment = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  contactId: number;
  contactName: string;
  contactEmail: string;
  status: EnrolmentStatus;
  nextPosition: number;
  stepCount: number;
  nextRunAt: string | null;
  stoppedReason: string;
  /** Why the next step is waiting, e.g. outside the recipient's send window or the sender's daily limit. */
  waitReason: string;
  senderName: string;
  enrolledAt: string;
  finishedAt: string | null;
  runs: StepRun[];
};

/* ── Mailboxes ────────────────────────────────────────────────────────── */

export type MailboxProvider = 'google' | 'microsoft';

export type ProviderStatus = {
  provider: MailboxProvider;
  label: string;
  configured: boolean;
  /** Environment variables still to set before this provider can connect. */
  missing: string[];
  redirectUri: string;
};

export type Mailbox = {
  id: string;
  provider: MailboxProvider;
  email: string;
  userId: string;
  userName: string;
  status: 'connected' | 'error' | 'revoked';
  lastError: string;
  lastSyncedAt: string | null;
  createdAt: string;
};

export type MailboxOverview = { providers: ProviderStatus[]; mailboxes: Mailbox[]; canManageAll: boolean };

export type InboxConversation = {
  contactId: number | null;
  contactName: string;
  contactEmail: string;
  subject: string;
  snippet: string;
  direction: 'inbound' | 'outbound' | null;
  at: string;
  count: number;
  source: 'mailbox' | 'logged' | 'sent';
};

/* ── Filters and helpers ──────────────────────────────────────────────── */

export type SalesFilterOptions = { campaigns: { id: string; name: string }[]; lostReasons: string[]; currencies: string[] };

export const taskTypeLabels: Record<TaskType, string> = {
  todo: 'To-do', call: 'Call', email: 'Email', meeting: 'Meeting', follow_up: 'Follow-up',
};

export const activityTypeLabels: Record<ActivityType, string> = {
  note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', other: 'Other',
};

/** Human label for where a deal or task came from. */
export function sourceLabel(source: string): string {
  if (!source || source === 'manual' || source === 'ovelio') return 'Created by hand';
  if (source === 'preview-seed') return 'Sample data';
  if (source.startsWith('flow:')) return 'Workflow';
  if (source.startsWith('form:')) return 'Form submission';
  if (source.startsWith('sequence:')) return 'Sequence';
  if (source.startsWith('import')) return 'Import';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/** The probability used for forecasting: the deal's override, else its stage's. Closed deals are 100 or 0. */
export function effectiveProbability(deal: { status: DealStatus; probability: number | null }, stageProbability: number): number {
  if (deal.status === 'won') return 100;
  if (deal.status === 'lost') return 0;
  return deal.probability ?? stageProbability;
}

/**
 * Board position for a card dropped between two neighbours (positions ascend down a column). Null neighbours mean
 * the top or bottom of the column. Returns null when the gap is too small and the column needs renumbering.
 */
export function positionBetween(previous: number | null, next: number | null): number | null {
  if (previous == null && next == null) return 0;
  if (previous == null) return (next as number) - 1;
  if (next == null) return previous + 1;
  if (next - previous < 1e-6) return null;
  return (previous + next) / 2;
}
