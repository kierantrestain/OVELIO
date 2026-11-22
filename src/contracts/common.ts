export type Role = 'admin' | 'marketer' | 'analyst';
export type User = { id: string; email: string; name: string; role: Role; disabled?: boolean };
export type Health = { status: 'ready' | 'unavailable'; message?: string };
export type DateRange = { startAt: number; endAt: number };
export type Point = { label: string; value: number };
export type Page<T> = { items: T[]; total: number; page: number; limit: number };
