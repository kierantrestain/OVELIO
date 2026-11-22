'use client';

import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { request, useAction } from './client';
import { Brand } from './shell';
import { Button, Feedback, Field } from './ui';

export function LoginForm() {
  const router = useRouter();
  const { run, busy, error } = useAction();
  return <main className="login-page">
    <section className="login-card">
      <Brand />
      <div className="login-heading"><h1>Sign in</h1><p>Access your OVELIO workspace.</p></div>
      <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        void run(async () => {
          await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
          router.replace('/overview');
          router.refresh();
        });
      }}>
        <Field label="Email address"><input type="email" name="email" autoComplete="username" required maxLength={254} /></Field>
        <Field label="Password"><input type="password" name="password" autoComplete="current-password" required maxLength={128} /></Field>
        <Feedback error={error} />
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></Button>
      </form>
    </section>
    <div className="login-art"><span className="login-orbit login-orbit--one" /><span className="login-orbit login-orbit--two" />
      <span className="login-orbit login-orbit--three" /><div><p>Marketing.<br />Connected.</p></div>
    </div>
  </main>;
}
