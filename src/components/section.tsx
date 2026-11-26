'use client';

// Mounts an existing engine-backed section at its OVELIO 2.0 route (src/components/nav.ts).
import { Analytics } from './analytics';
import { Audience, ContactView } from './audience';
import { Automations } from './automations';
import { CampaignView, Campaigns } from './campaigns';
import { Settings } from './settings';
import { SectionFrameProvider } from './ui';

type Frame = { title: string; description?: string };

export function AudienceSection({ tab, ...frame }: Frame & { tab: string }) {
  return <SectionFrameProvider frame={{ ...frame, hiddenTabs: ['Audience view'] }}><Audience key={tab} initialTab={tab} /></SectionFrameProvider>;
}

export function CampaignsSection({ tab, ...frame }: Frame & { tab: string }) {
  return <SectionFrameProvider frame={{ ...frame, hiddenTabs: ['Campaign view'] }}><Campaigns key={tab} initialTab={tab} /></SectionFrameProvider>;
}

export function AutomationsSection({ tab, ...frame }: Frame & { tab: string }) {
  return <SectionFrameProvider frame={{ ...frame, hiddenTabs: ['Automation view'] }}><Automations key={tab} initialTab={tab} /></SectionFrameProvider>;
}

export function SettingsSection({ tab, ...frame }: Frame & { tab: string }) {
  return <SectionFrameProvider frame={{ ...frame, hiddenTabs: ['Settings view'] }}><Settings key={tab} initialTab={tab} /></SectionFrameProvider>;
}

export function WebsiteAnalyticsSection({ trackingOrigin, tab }: { trackingOrigin?: string; tab?: string }) {
  return <SectionFrameProvider frame={{ title: 'Website analytics', description: 'Traffic, sources, sessions, goals and journeys from your tracked websites.', hiddenTabs: [] }}>
    <Analytics trackingOrigin={trackingOrigin} initialTab={tab} />
  </SectionFrameProvider>;
}

export function LegacyContactView({ id }: { id: string }) {
  return <ContactView id={id} />;
}

export function LegacyCampaignView({ id }: { id: string }) {
  return <CampaignView id={id} />;
}
