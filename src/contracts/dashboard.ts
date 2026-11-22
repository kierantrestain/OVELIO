import type { CampaignMetrics, RunningCampaignStat } from './campaigns';
import type { Health, Point, User } from './common';

/* ── Unified Dashboard & Settings ──────────────────────────────────────────── */

export type Activity = { id: string; description: string; at: string; href?: string };

export type Dashboard = {
  contacts: number | null;
  contactGrowth: Point[] | null;
  activeCampaigns: number | null;
  runningCampaigns?: RunningCampaignStat[];
  activeWorkflows: number | null;
  email: CampaignMetrics;
  emailTrend: Point[] | null;
  emailClicksTrend?: Point[] | null;
  emailBouncesTrend?: Point[] | null;
  visitors: number | null;
  activeVisitors?: number | null;
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

/** Whether opens and clicks are recorded: not at all, as anonymous totals, or per subscriber. */
export type TrackingMode = 'off' | 'anonymous' | 'individual';

export type DeliverySettings = {
  concurrency: number;
  messageRate: number;
  batchSize: number;
  maxSendErrors: number;
  slidingWindow: boolean;
  slidingWindowDuration: string;
  slidingWindowRate: number;
  trackingMode: TrackingMode;
  recordOptinIp: boolean;
};

export type DeliverySettingsInput = Partial<DeliverySettings>;

export type DeliverySettingsResult = DeliverySettings & { needsRestart: boolean };
