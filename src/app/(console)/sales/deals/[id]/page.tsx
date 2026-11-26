import { DealView } from '@/components/crm/deals';

export const metadata = { title: 'Deal' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DealView id={(await params).id} />;
}
