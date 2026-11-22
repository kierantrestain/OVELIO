import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { currentUser } from '@/server/auth';
import { devPreviewCompany, isDevPreviewMode } from '@/server/dev-preview';
import { company } from '@/server/reporting';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const devPreview = isDevPreviewMode();
  const profile = devPreview ? devPreviewCompany() : await company();
  return <Shell user={user} workspace={{ name: profile.name, accent: profile.accent }} devPreview={devPreview}>{children}</Shell>;
}
