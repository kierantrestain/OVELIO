import { SalesDeals } from '@/components/crm/deals';

export const metadata = { title: 'Deals' };

export default async function Page({ searchParams }: { searchParams: Promise<{ create?: string; view?: string }> }) {
  const params = await searchParams;
  return <SalesDeals initialCreate={params.create === 'deal'} initialView={params.view} />;
}
