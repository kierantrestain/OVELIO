import { Suspense } from 'react';
import { FunnelAnalytics } from '@/components/insights/detail';

export const metadata = { title: 'Funnel analytics' };

export default function Page() {
  return <Suspense><FunnelAnalytics /></Suspense>;
}
