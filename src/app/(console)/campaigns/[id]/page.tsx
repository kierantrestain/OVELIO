import { CampaignView } from '@/components/campaigns';

export const metadata = { title: 'Newsletter' };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  return <CampaignView id={(await params).id} />;
}
