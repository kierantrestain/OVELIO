import { Suspense } from 'react';
import { LandingPages } from '@/components/sites/pages-list';

export const metadata = { title: 'Landing pages' };

export default function Page() {
  return <Suspense><LandingPages /></Suspense>;
}
