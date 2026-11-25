import { Suspense } from 'react';
import { WorkflowTemplates } from '@/components/journeys/automation-pages';

export const metadata = { title: 'Workflow templates' };

export default function Page() {
  return <Suspense><WorkflowTemplates /></Suspense>;
}
