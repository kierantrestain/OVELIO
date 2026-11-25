import { redirect } from 'next/navigation';
import { WorkflowsList } from '@/components/journeys/automation-pages';

export const metadata = { title: 'Workflows' };

// Links from before OVELIO 2.0 used ?tab=; send them to the section's new home.
const moved: Record<string, string> = {
  'journey emails': '/automations/emails', 'lead forms': '/sites/classic-forms', assets: '/sites/assets',
  'landing pages': '/sites/classic-pages', 'dynamic content': '/sites/dynamic-content', 'popups & bars': '/sites/popups',
  categories: '/automations/categories', webhooks: '/automations/webhooks',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab?.trim().toLowerCase();
  if (tab && moved[tab]) redirect(moved[tab]);
  return <WorkflowsList />;
}
