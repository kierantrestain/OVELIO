import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { currentUser } from '@/server/auth';
import { company } from '@/server/reporting';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [user, jar] = await Promise.all([currentUser(), cookies()]);
  if (!user) redirect('/login');
  const profile = await company();
  return <Shell user={user} workspace={{ name: profile.name, accent: profile.accent }}
    theme={jar.get('ovelio_theme')?.value === 'dark' ? 'dark' : 'light'}>{children}</Shell>;
}
