import { MauticJourneyEditor } from '@/components/automations';

export const metadata = { title: 'Segment journey' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MauticJourneyEditor id={(await params).id} />;
}
