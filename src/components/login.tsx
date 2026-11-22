'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { request, useAction, useFields } from './client';
import { Brand } from './shell';
import { Feedback } from './ui';

export function LoginForm() {
  const router = useRouter();
  const { run, busy, error } = useAction();
  const { values, field } = useFields({ email: '', password: '' });
  return <main className="ov-login">
    <section className="ov-login-form">
      <Brand />
      <div className="ov-stack-sm"><Heading level={1}>Sign in</Heading><Text color="secondary">Access your OVELIO workspace.</Text></div>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
          router.replace('/overview');
          router.refresh();
        });
      }}>
        <TextInput label="Email address" type="email" autoComplete="username" isRequired hasAutoFocus {...field('email')} />
        <TextInput label="Password" type="password" autoComplete="current-password" isRequired {...field('password')} />
        <Feedback error={error} />
        <Button type="submit" variant="primary" label="Sign in" isLoading={busy} isDisabled={!values.email || !values.password} />
      </form>
    </section>
    <div className="ov-login-art" aria-hidden="true"><p>Marketing.<br />Connected.</p></div>
  </main>;
}
