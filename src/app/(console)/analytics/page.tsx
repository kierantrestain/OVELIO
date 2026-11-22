import { Analytics } from '@/components/analytics';

export const metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return <Analytics trackingOrigin={process.env.TRACKING_ORIGIN || process.env.APP_ORIGIN} />;
}
