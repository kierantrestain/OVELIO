import { CrmCompaniesList } from '@/components/crm/lists';

export const metadata = { title: 'Companies' };

export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  return <CrmCompaniesList initialCreate={(await searchParams).create === 'company'} />;
}
