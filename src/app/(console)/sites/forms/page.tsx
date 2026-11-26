import { Suspense } from 'react';
import { FormsList } from '@/components/sites/forms';

export const metadata = { title: 'Forms' };

export default function Page() {
  return <Suspense><FormsList /></Suspense>;
}
