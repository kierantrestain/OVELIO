import { notFound } from 'next/navigation';
import { PageBuilder } from '@/components/sites/page-builder';

export const metadata = { title: 'Page builder' };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ variant?: string }> }) {
  const { id } = await params;
  const { variant } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  return <PageBuilder key={`${id}:${variant ?? 'a'}`} pageId={id} variant={variant && /^[a-h]$/.test(variant) ? variant : null} />;
}
