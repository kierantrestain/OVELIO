import { CalendarWorkspace } from '@/components/calendar/workspace';

export const metadata = { title: 'Calendar' };

export default async function Page({ searchParams }: { searchParams: Promise<{ calendarConnection?: string }> }) {
  return <CalendarWorkspace connectionFailed={(await searchParams).calendarConnection === 'failed'} />;
}
