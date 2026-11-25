import { redirect } from 'next/navigation';
import { SettingsSection } from '@/components/section';

export const metadata = { title: 'Settings' };

const moved: Record<string, string> = { team: '/settings/team', connections: '/settings/connections', 'data & privacy': '/settings/privacy' };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; tab?: string }> }) {
  const params = await searchParams;
  const view = (params.tab ?? params.view)?.trim().toLowerCase();
  if (view && moved[view]) redirect(moved[view]);
  return <SettingsSection tab="Company" title="Company" description="Workspace name, branding and the postal address in every email." />;
}
