import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { StudioFrame } from '@/components/shell';
import { currentUser } from '@/server/auth';
import { isDevPreviewMode } from '@/server/dev-preview';

// Full-screen editors: signed-in marketers only, without the workspace chrome.
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role === 'analyst') redirect('/overview');
  return <StudioFrame user={user} devPreview={isDevPreviewMode()}>{children}</StudioFrame>;
}
