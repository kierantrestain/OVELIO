import { Audience } from '@/components/audience';

export const metadata = { title: 'Audience' };

export default async function AudiencePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const raw = (await searchParams).tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;
  return <Audience key={tab ?? 'Contacts'} initialTab={tab} />;
}
