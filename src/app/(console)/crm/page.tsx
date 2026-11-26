import { CrmContactsList } from '@/components/crm/lists';

export const metadata = { title: 'Contacts' };

export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  return <CrmContactsList initialCreate={(await searchParams).create === 'contact'} />;
}
