import { redirect } from 'next/navigation';

const moved: Record<string, string> = { newsletters: '/marketing/emails', templates: '/marketing/templates', media: '/marketing/media', transactional: '/marketing/transactional' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab?.trim().toLowerCase();
  redirect(tab && moved[tab] ? moved[tab] : '/marketing/emails');
}
