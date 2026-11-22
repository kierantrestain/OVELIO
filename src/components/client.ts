'use client';

import { useEffect, useState } from 'react';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || (response.status === 401 ? 'Sign in to continue.' : 'The request could not be completed.'));
  }
  if (response.status === 204) return undefined as T;
  return (response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text()) as Promise<T>;
}

export function api<T>(path: string, method = 'GET', body?: unknown) {
  return request<T>('/api/console' + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type DataState<T> = { path: string; revision: number; data?: T; error?: string };

export function useResource<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<DataState<T>>();

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    request<T>('/api/console' + path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ path, revision, data });
    }, error => {
      if (!controller.signal.aborted) setState({ path, revision, error: message(error) });
    });
    return () => controller.abort();
  }, [path, revision]);

  const current = state?.path === path ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!path && current?.revision !== revision,
    refresh: () => setRevision(value => value + 1),
  };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function run(task: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await task();
      if (success) setNotice(success);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-GB').format(value);
export const date = (value: string | number | null | undefined) => value == null ? '—' : new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: typeof value === 'string' && value.includes('T') ? 'short' : undefined,
}).format(new Date(value));
