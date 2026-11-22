import { Campaigns } from '@/components/campaigns';

export const metadata = { title: 'Campaigns' };

const validTabs = ['Newsletters', 'Templates', 'Media', 'Transactional'] as const;

function resolveTab(raw?: string) {
  const normalized = raw?.trim().toLowerCase();
  return validTabs.find(item => item.toLowerCase() === normalized) ?? 'Newsletters';
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = resolveTab((await searchParams).tab);
  return <Campaigns key={tab} initialTab={tab} />;
}
