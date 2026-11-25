import { redirect } from 'next/navigation';
import { LaneStub } from '@/components/lane-stub';

export const metadata = { title: 'Executive analytics' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  if (tab) redirect('/analytics/website?tab=' + encodeURIComponent(tab));
  return <LaneStub title="Executive analytics" lane="Agent 5 · Analytics" />;
}
