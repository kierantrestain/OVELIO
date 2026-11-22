import { Automations } from '@/components/automations';

export const metadata = { title: 'Automations' };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <Automations key={tab ?? 'Workflows'} initialTab={tab} />;
}
