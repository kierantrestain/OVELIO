import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login';
import { currentUser } from '@/server/auth';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/overview');
  return <LoginForm />;
}
