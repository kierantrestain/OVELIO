// Builds the unified communication timeline for deals, contacts and companies: logged activities, OVELIO's own
// messages (with their real delivery status) and platform events from every module.
import type { Activity, MessageSummary, TeamMember, TimelineItem } from '@/contracts/crm';
import { activityTypeLabels } from '@/contracts/crm';
import type { PlatformEvent } from '@/contracts/platform';

const money = (amount: number | null, currency: string | null) => amount == null ? '' : new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: currency || 'GBP', maximumFractionDigits: 0,
}).format(amount);

const text = (value: unknown) => typeof value === 'string' ? value : '';

/** Events already shown through their own record (activities and messages) are left out of the timeline. */
const duplicated = new Set(['activity.logged', 'email.sent']);

export function eventTitle(event: PlatformEvent): { title: string; detail?: string; tone?: TimelineItem['tone'] } {
  const p = event.properties;
  switch (event.type) {
    case 'deal.created': return { title: `Deal created: ${text(p.name) || 'deal'}`, detail: text(p.stageName) ? `Stage ${text(p.stageName)}` : undefined };
    case 'deal.stage_changed': return { title: `Moved to ${text(p.stageName) || 'another stage'}` };
    case 'deal.won': return { title: `Deal won${text(p.name) ? `: ${text(p.name)}` : ''}`, detail: money(event.amount, event.currency), tone: 'success' };
    case 'deal.lost': return { title: `Deal lost${text(p.name) ? `: ${text(p.name)}` : ''}`, detail: text(p.reason) || undefined, tone: 'error' };
    case 'deal.updated': return { title: `Deal updated${text(p.name) ? `: ${text(p.name)}` : ''}`, detail: Array.isArray(p.changes) ? `Changed ${(p.changes as string[]).join(', ')}` : undefined };
    case 'task.created': return { title: `Task created: ${text(p.title)}` };
    case 'task.completed': return { title: `Task completed: ${text(p.title)}`, tone: 'success' };
    case 'contact.owner_changed': return { title: 'Owner changed', detail: text(p.ownerName) ? `Now owned by ${text(p.ownerName)}` : 'Owner removed' };
    case 'contact.created': return { title: 'Contact created', detail: text(p.source) || undefined };
    case 'contact.updated': return { title: 'Contact updated' };
    case 'contact.tagged': return { title: 'Tags changed', detail: Array.isArray(p.tags) ? (p.tags as string[]).join(', ') : undefined };
    case 'company.created': return { title: 'Company created' };
    case 'email.replied': return { title: 'Replied to an email', detail: text(p.subject) || undefined, tone: 'info' };
    case 'email.opened': return { title: 'Opened an email', detail: text(p.subject) || undefined };
    case 'email.clicked': return { title: 'Clicked a link in an email', detail: text(p.url) || undefined };
    case 'email.bounced': return { title: 'Email bounced', detail: text(p.reason) || undefined, tone: 'error' };
    case 'email.unsubscribed': return { title: 'Unsubscribed', tone: 'warning' };
    case 'sequence.enrolled': return { title: `Enrolled in sequence ${text(p.sequenceName)}`.trim() };
    case 'sequence.completed': return { title: `Finished sequence ${text(p.sequenceName)}`.trim(), tone: 'success' };
    case 'sequence.stopped': return { title: `Sequence stopped: ${text(p.sequenceName)}`, detail: text(p.reason) || undefined, tone: 'warning' };
    case 'form.submitted': return { title: `Submitted form ${text(p.formName)}`.trim(), tone: 'info' };
    case 'page.viewed': return { title: 'Viewed a landing page', detail: text(p.pageName) || undefined };
    case 'page.converted': return { title: 'Converted on a landing page', detail: text(p.pageName) || undefined, tone: 'info' };
    case 'funnel.step_viewed': return { title: 'Viewed a funnel step' };
    case 'funnel.completed': return { title: 'Completed a funnel', tone: 'success' };
    case 'campaign.launched': return { title: 'Campaign launched' };
    case 'flow.enrolled': return { title: `Entered workflow ${text(p.flowName)}`.trim() };
    case 'flow.completed': return { title: `Completed workflow ${text(p.flowName)}`.trim() };
    case 'flow.failed': return { title: `Workflow step failed ${text(p.flowName)}`.trim(), detail: text(p.error) || undefined, tone: 'error' };
    case 'quote.sent': return { title: `Proposal sent: ${text(p.title) || text(p.number)}`, detail: money(event.amount, event.currency) };
    case 'quote.viewed': return { title: `Proposal viewed: ${text(p.title) || text(p.number)}`, tone: 'info' };
    case 'quote.accepted': return { title: `Proposal accepted: ${text(p.title) || text(p.number)}`, detail: text(p.signerName) ? `Signed by ${text(p.signerName)}` : undefined, tone: 'success' };
    case 'quote.declined': return { title: `Proposal declined: ${text(p.title) || text(p.number)}`, detail: text(p.reason) || undefined, tone: 'warning' };
    case 'invoice.issued': return { title: `Invoice issued: ${text(p.number)}`, detail: money(event.amount, event.currency) };
    case 'payment.succeeded': return { title: 'Payment received', detail: [money(event.amount, event.currency), text(p.number)].filter(Boolean).join(' · '), tone: 'success' };
    case 'payment.failed': return { title: 'Payment failed', detail: text(p.reason) || undefined, tone: 'error' };
    case 'payment.refunded': return { title: 'Payment refunded', detail: money(event.amount, event.currency), tone: 'warning' };
    case 'subscription.started': return { title: `Subscription started: ${text(p.name)}`.trim(), detail: money(event.amount, event.currency), tone: 'success' };
    case 'subscription.renewed': return { title: `Subscription renewed: ${text(p.name)}`.trim(), detail: money(event.amount, event.currency) };
    case 'subscription.cancelled': return { title: `Subscription cancelled: ${text(p.name)}`.trim(), tone: 'warning' };
    case 'appointment.booked': return { title: `Meeting booked: ${text(p.title)}`.trim(), detail: text(p.startsAtLabel) || undefined, tone: 'info' };
    case 'appointment.rescheduled': return { title: `Meeting rescheduled: ${text(p.title)}`.trim(), detail: text(p.startsAtLabel) || undefined };
    case 'appointment.cancelled': return { title: `Meeting cancelled: ${text(p.title)}`.trim(), detail: text(p.reason) || undefined, tone: 'warning' };
    case 'appointment.completed': return { title: `Meeting held: ${text(p.title)}`.trim(), tone: 'success' };
    case 'appointment.no_show': return { title: `No-show: ${text(p.title)}`.trim(), tone: 'error' };
    default: return { title: event.type };
  }
}

const messageStatus: Record<MessageSummary['status'], { label: string; tone: TimelineItem['tone'] }> = {
  sent: { label: 'Sent', tone: 'success' },
  not_sent: { label: 'Not delivered', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'error' },
  failed: { label: 'Failed', tone: 'error' },
};

export function buildTimeline(input: {
  activities?: Activity[]; events?: PlatformEvent[]; messages?: MessageSummary[]; team?: Map<string, TeamMember>; limit?: number;
}): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const activity of input.activities ?? []) {
    const label = activityTypeLabels[activity.type];
    const direction = activity.direction === 'inbound' ? ' received' : activity.direction === 'outbound' ? ' sent' : '';
    items.push({
      id: 'activity:' + activity.id, kind: 'activity', type: activity.type, at: activity.occurredAt,
      title: activity.subject || `${label}${direction}`,
      detail: [activity.type === 'note' ? '' : label + direction, activity.outcome, activity.durationMinutes ? `${activity.durationMinutes} min` : '', activity.body]
        .filter(Boolean).join(' · ') || undefined,
      actor: activity.authorName || undefined,
      href: activity.dealId ? `/sales/deals/${activity.dealId}` : undefined,
    });
  }
  for (const message of input.messages ?? []) {
    const status = messageStatus[message.status];
    items.push({
      id: 'message:' + message.id, kind: 'message', type: 'email.' + message.status, at: message.createdAt,
      title: `Email: ${message.subject}`, detail: `${status.label} to ${message.toEmail}${message.statusReason ? ` · ${message.statusReason}` : ''}`,
      tone: status.tone,
    });
  }
  for (const event of input.events ?? []) {
    if (duplicated.has(event.type)) continue;
    const label = eventTitle(event);
    items.push({
      id: 'event:' + event.id, kind: 'event', type: event.type, at: event.occurredAt, title: label.title, detail: label.detail, tone: label.tone,
      actor: event.actorId ? input.team?.get(event.actorId)?.name : undefined,
      href: event.dealId && event.type.startsWith('deal.') ? `/sales/deals/${event.dealId}` : undefined,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, input.limit ?? 200);
}
