import { FormEditor } from '@/components/sites/forms';

export const metadata = { title: 'Form' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <FormEditor id={(await params).id} />;
}
