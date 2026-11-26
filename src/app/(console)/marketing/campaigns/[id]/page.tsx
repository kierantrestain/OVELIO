import { CampaignWorkspace } from '@/components/journeys/campaign-hub';

export const metadata = { title: 'Campaign' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CampaignWorkspace id={(await params).id} />;
}
