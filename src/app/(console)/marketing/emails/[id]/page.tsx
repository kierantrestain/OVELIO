import { LegacyCampaignView } from '@/components/section';

export const metadata = { title: 'Email' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <LegacyCampaignView id={(await params).id} />;
}
