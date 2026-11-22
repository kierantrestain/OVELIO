import { Audience } from '@/components/audience';

export const metadata = { title: 'Audience' };

export default async function AudiencePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <Audience key={tab ?? 'Contacts'} initialTab={tab} />;
}
