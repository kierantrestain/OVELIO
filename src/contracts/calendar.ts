export type WeeklyWindow = { weekday: number; start: string; end: string };
export type Availability = { timeZone: string; windows: WeeklyWindow[] };
export type BookingTypeInput = {
  name: string;
  slug: string;
  hostIds: string[];
  durationMinutes: number;
  bufferMinutes: number;
  active: boolean;
};
export type BookingType = BookingTypeInput & { id: string; canEdit: boolean };
export type AppointmentStatus = 'booked' | 'cancelled' | 'completed' | 'no_show';
export type Appointment = {
  id: string;
  title: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  timeZone: string;
};
export type ConsoleAppointment = Appointment & {
  hostId: string;
  hostName: string;
  guestName: string;
  guestEmail: string;
  contactId: number;
  dealId: string | null;
  hasStarted: boolean;
};
export type PublicBooking = {
  name: string;
  slug: string;
  durationMinutes: number;
  slots: string[];
};
export type ManagedBooking = Appointment & { slots: string[]; canChange: boolean };
export type BookingConfirmation = Appointment & { manageUrl: string };
export type CalendarOverview = {
  availability: Availability;
  hosts: { id: string; name: string }[];
  types: BookingType[];
  meetings: ConsoleAppointment[];
  canManageTeam: boolean;
  hasFeed: boolean;
};

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
};
