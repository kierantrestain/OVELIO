import { notFound } from 'next/navigation';
import { PublicBookingScreen } from '@/components/calendar/public-booking';
import { AppError } from '@/server/config';
import { publicBooking } from '@/server/calendar/booking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Book an appointment' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const booking = await publicBooking(slug).catch(error => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return <PublicBookingScreen booking={booking} />;
}
