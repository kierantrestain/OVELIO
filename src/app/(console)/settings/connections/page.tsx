import { SettingsSection } from '@/components/section';

export const metadata = { title: 'Connections' };

export default function Page() {
  return <SettingsSection tab="Connections" title="Connections" description="Engines, SMTP delivery, DNS and background jobs." />;
}
