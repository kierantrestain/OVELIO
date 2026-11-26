import { AudienceSection } from '@/components/section';

export const metadata = { title: 'Consent & suppressions' };

export default function Page() {
  return <AudienceSection tab="Suppressions" title="Consent & suppressions" description="Who must not be emailed, and why." />;
}
