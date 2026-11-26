import { CompanyProfileView } from '@/components/crm/profiles';

export const metadata = { title: 'Company' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CompanyProfileView id={(await params).id} />;
}
