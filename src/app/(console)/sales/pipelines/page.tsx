import { LeadRouting, PipelineSettings } from '@/components/crm/settings';

export const metadata = { title: 'Pipelines' };

export default function Page() {
  return <div className="ov-stack">
    <PipelineSettings />
    <LeadRouting />
  </div>;
}
