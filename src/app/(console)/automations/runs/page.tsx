import { Suspense } from 'react';
import { RunHistory } from '@/components/journeys/automation-pages';

export const metadata = { title: 'Run history' };

export default function Page() {
  return <Suspense><RunHistory /></Suspense>;
}
