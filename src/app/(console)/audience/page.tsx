import { redirect } from 'next/navigation';

const moved: Record<string, string> = {
  contacts: '/crm', segments: '/crm/segments', 'mailing lists': '/marketing/lists', 'tags & stages': '/crm/lifecycle',
  companies: '/crm/companies', 'lead scoring': '/crm/scoring', suppressions: '/crm/consent', 'custom fields': '/crm/fields',
};

export default async function AudiencePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const raw = (await searchParams).tab;
  const tab = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  redirect(tab && moved[tab] ? moved[tab] : '/crm');
}
