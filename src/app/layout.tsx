import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OVELIO', template: '%s | OVELIO' },
  description: 'Marketing. Connected.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('ovelio_theme')?.value === 'dark' ? 'dark' : 'light';
  return <html lang="en" data-theme={theme}><body>{children}</body></html>;
}
