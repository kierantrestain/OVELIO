import { EmailStudio } from '@/components/studio/editor';

export const metadata = { title: 'Email studio' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmailStudio key={id} id={id} />;
}
