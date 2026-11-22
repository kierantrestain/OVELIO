import { Settings } from '@/components/settings';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const connections = (await searchParams).view === 'connections';
  return <Settings key={connections ? 'connections' : 'company'} initialTab={connections ? 'Connections' : 'Company'} />;
}
