import { SettingsSection } from '@/components/section';

export const metadata = { title: 'Team' };

export default function Page() {
  return <SettingsSection tab="Team" title="Team" description="Who can sign in, and what they can do." />;
}
