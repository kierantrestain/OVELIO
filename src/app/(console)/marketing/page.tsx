import { Suspense } from 'react';
import { CampaignHub } from '@/components/journeys/campaign-hub';

export const metadata = { title: 'Campaigns' };

export default function Page() {
  return <Suspense><CampaignHub /></Suspense>;
}
