import { Suspense } from 'react';
import { MarketingAnalytics } from '@/components/insights/detail';

export const metadata = { title: 'Marketing analytics' };

export default function Page() {
  return <Suspense><MarketingAnalytics /></Suspense>;
}
