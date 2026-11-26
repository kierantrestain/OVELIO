import { Suspense } from 'react';
import { SalesAnalytics } from '@/components/insights/detail';

export const metadata = { title: 'Sales analytics' };

export default function Page() {
  return <Suspense><SalesAnalytics /></Suspense>;
}
