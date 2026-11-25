import { MailboxSettings } from '@/components/crm/settings';

export const metadata = { title: 'Mailboxes' };

export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const params = await searchParams;
  return <MailboxSettings connected={params.connected?.slice(0, 254)} error={params.error?.slice(0, 300)} />;
}
