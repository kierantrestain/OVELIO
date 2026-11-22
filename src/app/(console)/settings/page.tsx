import { Settings } from '@/components/settings';
import type { SettingsTab } from '@/components/settings';

export const metadata = { title: 'Settings' };

const validTabs: readonly SettingsTab[] = ['Company', 'Team', 'Connections', 'Data & privacy'];

function resolveTab(tab?: string, view?: string): SettingsTab {
  const normalized = tab?.trim().toLowerCase();
  const match = validTabs.find(item => item.toLowerCase() === normalized);
  if (match) return match;
  if (view?.trim().toLowerCase() === 'connections') return 'Connections';
  return 'Company';
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const initialTab = resolveTab(params.tab, params.view);
  return <Settings key={initialTab} initialTab={initialTab} />;
}
