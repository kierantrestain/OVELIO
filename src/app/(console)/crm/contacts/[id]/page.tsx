import { ContactProfileView } from '@/components/crm/profiles';

export const metadata = { title: 'Contact' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ContactProfileView id={(await params).id} />;
}
