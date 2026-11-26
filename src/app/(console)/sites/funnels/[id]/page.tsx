import { FunnelEditor } from '@/components/sites/funnels';

export const metadata = { title: 'Funnel' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <FunnelEditor id={(await params).id} />;
}
