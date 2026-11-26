import { Suspense } from 'react';
import { AttributionAnalytics } from '@/components/insights/detail';

export const metadata = { title: 'Attribution' };

export default function Page() {
  return <Suspense><AttributionAnalytics /></Suspense>;
}
