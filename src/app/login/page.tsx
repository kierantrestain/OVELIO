import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login';
import { currentUser } from '@/server/auth';
import { AUTH0_ERROR_MESSAGES, isAuth0Configured } from '@/server/auth0';
import { isDevPreviewMode, isLocalDevLoginEnabled } from '@/server/dev-preview';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect('/overview');
  const params = await searchParams;
  const errorCode = params.error?.trim() ?? '';
  const initialError = errorCode ? AUTH0_ERROR_MESSAGES[errorCode] : undefined;
  const devPreview = isDevPreviewMode();
  const showDevLogin = devPreview || isLocalDevLoginEnabled();
  return <LoginForm
    auth0Enabled={isAuth0Configured()}
    showDevLogin={showDevLogin}
    devPreview={devPreview}
    initialError={initialError}
  />;
}
