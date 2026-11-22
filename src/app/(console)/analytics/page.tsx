import { Analytics } from '@/components/analytics';

export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <Analytics
      key={tab ?? ''}
      initialTab={tab}
      trackingOrigin={process.env.TRACKING_ORIGIN || process.env.APP_ORIGIN}
    />
  );
}
