import { InvoiceList } from '@/components/revenue/billing';

export const metadata = { title: 'Invoices' };

export default async function Page({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice } = await searchParams;
  return <InvoiceList initialInvoice={invoice && /^[0-9a-f-]{36}$/.test(invoice) ? invoice : undefined} />;
}
