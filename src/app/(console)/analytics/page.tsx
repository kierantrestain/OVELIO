import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ExecutiveAnalytics } from '@/components/insights/executive';

export const metadata = { title: 'Executive analytics' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  if (tab) redirect('/analytics/website?tab=' + encodeURIComponent(tab));
  return <Suspense><ExecutiveAnalytics /></Suspense>;
}
