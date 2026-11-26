import { notFound } from 'next/navigation';
import { ManageBookingScreen } from '@/components/calendar/public-booking';
import { AppError } from '@/server/config';
import { manageBooking } from '@/server/calendar/booking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manage your booking', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await manageBooking(token).catch(error => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return <ManageBookingScreen initial={booking} token={token} />;
}
