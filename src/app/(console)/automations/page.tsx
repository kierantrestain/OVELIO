import { Automations } from '@/components/automations';

export const metadata = { title: 'Automations' };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const raw = (await searchParams).tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;
  return <Automations key={tab ?? 'Workflows'} initialTab={tab} />;
}
