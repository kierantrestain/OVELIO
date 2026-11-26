import { CampaignsSection } from '@/components/section';

export const metadata = { title: 'Transactional' };

export default function Page() {
  return <CampaignsSection tab="Transactional" title="Transactional" description="System emails sent one at a time: receipts, confirmations, notifications." />;
}
