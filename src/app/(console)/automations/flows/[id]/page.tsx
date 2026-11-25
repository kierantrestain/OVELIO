import { FlowBuilder } from '@/components/journeys/flow-builder';

export const metadata = { title: 'Workflow builder' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <FlowBuilder id={(await params).id} />;
}
