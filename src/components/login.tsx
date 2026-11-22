'use client';

import { CodeXml, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { request, useAction, useFields } from './client';
import { Brand } from './shell';
import { Feedback } from './ui';

export function LoginForm({
  auth0Enabled = false,
  showDevLogin = false,
  devPreview = false,
  initialError,
}: {
  auth0Enabled?: boolean;
  showDevLogin?: boolean;
  devPreview?: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const { run, busy, error } = useAction();
  const devLogin = useAction();
  const { values, field } = useFields({ email: '', password: '' });
  return <main className="ov-login">
    <section className="ov-login-form">
      <Brand />
      <div className="ov-stack-sm"><Heading level={1}>Sign in</Heading><Text color="secondary">Access your OVELIO workspace.</Text></div>
      {auth0Enabled ? <div className="ov-stack-sm">
        <form method="GET" action="/api/auth/auth0/login">
          <Button
            type="submit"
            variant="primary"
            icon={<ShieldCheck size={16} />}
            label="Continue with Auth0"
            isDisabled={busy || devLogin.busy}
          />
        </form>
        <Divider />
      </div> : null}
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
          router.replace('/overview');
          router.refresh();
        });
      }}>
        <TextInput label="Email address" type="email" autoComplete="username" isRequired hasAutoFocus={!auth0Enabled} {...field('email')} />
        <TextInput label="Password" type="password" autoComplete="current-password" isRequired {...field('password')} />
        <Feedback error={error || devLogin.error || initialError} />
        <Button type="submit" variant={auth0Enabled ? 'secondary' : 'primary'} label="Sign in" isLoading={busy} isDisabled={!values.email || !values.password || devLogin.busy} />
      </form>
      {showDevLogin ? <div className="ov-stack-sm">
        <Divider />
        <Text type="supporting" color="secondary">
          {devPreview
            ? 'Preview deployment detected without connected backend engines. Launch an interactive sandbox session to test all screens.'
            : 'Local developer sign-in is enabled for testing.'}
        </Text>
        <Button
          type="button"
          variant="secondary"
          icon={<CodeXml size={16} />}
          label="Sign in as test developer"
          isLoading={devLogin.busy}
          isDisabled={busy}
          onClick={() => void devLogin.run(async () => {
            await request('/api/auth/dev-login', { method: 'POST' });
            router.replace('/overview');
            router.refresh();
          })}
        />
      </div> : null}
    </section>
    <div className="ov-login-art" aria-hidden="true"><p>Marketing.<br />Connected.</p></div>
  </main>;
}
