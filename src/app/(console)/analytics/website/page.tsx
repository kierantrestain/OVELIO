import { WebsiteAnalyticsSection } from '@/components/section';

export const metadata = { title: 'Website analytics' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <WebsiteAnalyticsSection key={tab ?? ''} tab={tab} trackingOrigin={process.env.TRACKING_ORIGIN || process.env.APP_ORIGIN} />;
}
