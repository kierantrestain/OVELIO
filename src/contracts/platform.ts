// OVELIO 2.0 shared platform contracts. Owned by the lead (docs/rebuild/TRACKER.md §2).
// Every module identifies people by the Mautic contact id (`contactId`) and companies by the Mautic company id.
// OVELIO-owned records (deals, designs, pages, campaigns, flows) use uuid ids.

import type { Consent } from './audience';

/** A person as every OVELIO module sees them. `contactId` is the master id (Mautic contact id). */
export type DirectoryContact = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  /** "First Last", or the email when both are empty. */
  name: string;
  company: string;
  phone: string;
  position: string;
  tags: string[];
  stageName: string | null;
  points: number;
  consent: Consent;
  suppressed: boolean;
  createdAt: string | null;
};

export type DirectoryCompany = { id: number; name: string; website: string; industry: string; city: string; country: string };

export type ContactUpsert = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  position?: string;
  city?: string;
  country?: string;
  website?: string;
  /** Added to the contact's existing tags; never removes any. */
  tags?: string[];
  /** Only `opted_in` with `evidence` records consent. Omit to leave consent as it is. */
  consent?: 'opted_in';
  evidence?: string;
  customFields?: Record<string, string | string[]>;
  /** Where the record came from, for the activity feed, e.g. "Form: Webinar sign-up". */
  source: string;
};

export type Utm = { source?: string; medium?: string; campaign?: string; term?: string; content?: string };

/**
 * The unified event contract. Modules emit these with `emitEvent` (src/server/events.ts); automations trigger on
 * them, sequences stop on `email.replied`, and analytics and attribution read them. Add a type here before using it.
 */
export const platformEventTypes = [
  'contact.created', 'contact.updated', 'contact.tagged', 'contact.owner_changed',
  'company.created',
  'deal.created', 'deal.updated', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'task.created', 'task.completed',
  'activity.logged',
  'email.sent', 'email.replied', 'email.opened', 'email.clicked', 'email.bounced', 'email.unsubscribed',
  'sequence.enrolled', 'sequence.completed', 'sequence.stopped',
  'form.submitted', 'page.viewed', 'page.converted', 'funnel.step_viewed', 'funnel.completed',
  'campaign.launched',
  'flow.enrolled', 'flow.completed', 'flow.failed',
  // Revenue (wave two): commercial documents, invoices and payments. Amounts are in the record's currency.
  'quote.sent', 'quote.viewed', 'quote.accepted', 'quote.declined',
  'invoice.issued', 'payment.succeeded', 'payment.failed', 'payment.refunded',
  'subscription.started', 'subscription.renewed', 'subscription.cancelled',
  // Calendar (wave two): appointments booked through booking links or by the team.
  'appointment.booked', 'appointment.rescheduled', 'appointment.cancelled', 'appointment.completed', 'appointment.no_show',
] as const;
export type PlatformEventType = (typeof platformEventTypes)[number];

export type PlatformEvent = {
  id: string;
  type: PlatformEventType;
  occurredAt: string;
  contactId: number | null;
  companyId: number | null;
  dealId: string | null;
  /** OVELIO marketing campaign (uuid) the event is attributed to, when known. */
  campaignId: string | null;
  /** The record the event is about, e.g. entityType 'form' with the form's id. */
  entityType: string | null;
  entityId: string | null;
  source: string;
  visitorId: string | null;
  /** Measured money value (closed deal amount, order value). Never an estimate. */
  amount: number | null;
  currency: string | null;
  utm: Utm;
  properties: Record<string, unknown>;
  actorId: string | null;
};

export type EventInput = {
  type: PlatformEventType;
  occurredAt?: Date | string;
  contactId?: number | null;
  companyId?: number | null;
  dealId?: string | null;
  campaignId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  source?: string;
  visitorId?: string | null;
  amount?: number | null;
  currency?: string | null;
  utm?: Utm;
  properties?: Record<string, unknown>;
  actorId?: string | null;
  /** Retrying with the same key never records the event twice. */
  idempotencyKey?: string;
};

export type SearchResultKind = 'contact' | 'company' | 'deal' | 'task' | 'campaign' | 'email' | 'template' | 'page' | 'form' | 'funnel' | 'flow'
  | 'quote' | 'invoice' | 'appointment';

export type SearchResult = { id: string; kind: SearchResultKind; title: string; subtitle?: string; href: string };

/** Saved table views shared by CRM, Sales and Marketing lists. */
export type ViewOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'empty' | 'not_empty' | 'before' | 'after';
export type ViewFilter = { field: string; operator: ViewOperator; value?: string | number | string[] };
export type SavedView = {
  id: string;
  object: string;
  name: string;
  filters: ViewFilter[];
  columns: string[];
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  shared: boolean;
  ownerId: string | null;
  createdAt: string;
};
export type SavedViewInput = Pick<SavedView, 'object' | 'name' | 'filters' | 'columns' | 'sort' | 'shared'>;

/** Labels every response built from sample records, so no screen presents demo data as live business data. */
export type DataProvenance = 'live' | 'preview_sample' | 'estimate';
