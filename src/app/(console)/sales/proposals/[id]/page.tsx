import { ProposalEditor } from '@/components/revenue/proposals';

export const metadata = { title: 'Proposal' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalEditor id={(await params).id} />;
}
