import { LegacyContactView } from '@/components/section';

export const metadata = { title: 'Contact' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <LegacyContactView id={(await params).id} />;
}
