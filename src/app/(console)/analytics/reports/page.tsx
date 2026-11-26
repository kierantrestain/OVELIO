import { Suspense } from 'react';
import { ReportCatalogue } from '@/components/insights/detail';

export const metadata = { title: 'Reports' };

export default function Page() {
  return <Suspense><ReportCatalogue /></Suspense>;
}
