export type Role = 'admin' | 'marketer' | 'analyst';
export type User = { id: string; email: string; name: string; role: Role };
export type Health = { status: 'ready' | 'unavailable'; message?: string };
export type DateRange = { startAt: number; endAt: number };
export type Point = { label: string; value: number };
export type Page<T> = { items: T[]; total: number; page: number; limit: number };

export type Contact = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  points: number;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
  suppressed: boolean;
};
export type Consent = 'unknown' | 'opted_in' | 'suppressed';
export type ContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  tags?: string[];
};
export type ContactDetail = Contact & {
  consent: Consent;
  segments: Segment[];
  activity: { label: string; at: string; type: string }[];
  mailingListIds?: number[];
};
export type Segment = { id: number; name: string; alias: string; description: string; published: boolean };
export type SegmentInput = { name: string; description?: string };
export type LeadForm = { id: number; name: string; submissions: number | null; published: boolean };
export type JourneyEmail = { id: number; name: string; subject: string; published: boolean };
export type WorkflowStep = { emailId: number; delayMinutes: number; condition?: 'opened_previous' | 'clicked_previous' };
export type WorkflowInput = { name: string; description?: string; segmentId: number; steps: WorkflowStep[] };
export type Workflow = WorkflowInput & { id: number; enabled: boolean; editable?: boolean };

export type MailingList = { id: number; name: string; subscriberCount: number | null; tags: string[] };
export type Subscriber = {
  id: number;
  email: string;
  blocked: boolean;
  lists: { id: number; status: 'unconfirmed' | 'confirmed' | 'unsubscribed' | string }[];
};
export type SubscriberInput = {
  email: string;
  name: string;
  mauticId: number;
  lists: number[];
};
export type Template = { id: number; name: string; body: string };
export type CampaignMetrics = {
  sent: number | null;
  delivered: number | null;
  opens: number | null;
  clicks: number | null;
  bounces: number | null;
  unsubscribes: number | null;
};
export type CampaignInput = {
  name: string;
  subject: string;
  body: string;
  listIds: number[];
  fromEmail?: string;
  templateId?: number;
};
export type Campaign = CampaignInput & {
  id: number;
  status: string;
  sendAt: string | null;
  createdAt: string | null;
  metrics: CampaignMetrics;
};
export type Website = { id: string; name: string; domain: string };
export type GoalInput = { name: string; type: 'event' | 'path'; value: string };
export type Goal = GoalInput & { id: string };
export type GoalStats = { total: number; unique: number };
export type Traffic = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
};
export type ReportDimension = 'path' | 'referrer' | 'device' | 'browser' | 'country' | 'event' | 'utmSource' | 'utmMedium' | 'utmCampaign';
export type FunnelStep = { type: 'event' | 'path'; value: string };
export type FunnelResult = { label: string; visitors: number }[];
export type WebsiteReport = {
  website: Website;
  range: DateRange;
  current: Traffic | null;
  previous: Traffic | null;
  pageviews: Point[] | null;
  visitors: Point[] | null;
  dimensions: Partial<Record<ReportDimension, Point[] | null>>;
};

export type Activity = { id: string; description: string; at: string; href?: string };
export type Dashboard = {
  contacts: number | null;
  contactGrowth: Point[] | null;
  activeCampaigns: number | null;
  activeWorkflows: number | null;
  email: CampaignMetrics;
  emailTrend: Point[] | null;
  visitors: number | null;
  websiteName?: string;
  traffic: Point[] | null;
  leads: number | null;
  conversions: number | null;
  conversionGoal?: string;
  recent: Activity[];
  alerts: { label: string; href: string }[];
};
export type CompanySettings = { name: string; website: string; accent: string; privacyUrl: string; postalAddress: string };
export type SenderSettings = { fromEmail: string; provider: string; smtpHost: string; configured: boolean; verifiedDomain: string };
export type Settings = {
  company: CompanySettings;
  sender: SenderSettings;
  health: { audience: Health; delivery: Health; tracking: Health; worker: Health };
  trackingOrigin: string;
  team: User[];
  failedJobs?: { id: string; kind: string; attempts: number; at: string }[];
};
