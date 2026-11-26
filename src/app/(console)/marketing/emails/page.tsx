import { Suspense } from 'react';
import { EmailsPage } from '@/components/studio/emails';

export const metadata = { title: 'Emails' };

export default function Page() {
  return <Suspense><EmailsPage /></Suspense>;
}
