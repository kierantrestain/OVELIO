'use client';

import Link from 'next/link';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { LinkProvider } from '@astryxdesign/core/Link';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

export type ColorMode = 'light' | 'dark';
const ModeContext = createContext<{ mode: ColorMode; toggle: () => void }>({ mode: 'light', toggle: () => {} });

export const useColorMode = () => useContext(ModeContext);

export function Providers({ initialMode, children }: { initialMode: ColorMode; children: ReactNode }) {
  const [mode, setMode] = useState(initialMode);
  function toggle() {
    const next = mode === 'light' ? 'dark' : 'light';
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `ovelio_theme=${next}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
    document.documentElement.dataset.theme = next;
    setMode(next);
  }
  return <ModeContext.Provider value={{ mode, toggle }}>
    <Theme theme={neutralTheme} mode={mode}>
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  </ModeContext.Provider>;
}
