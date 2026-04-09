'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="midnight"
      themes={['midnight', 'soft-light', 'dim', 'sunset', 'system']}
      enableSystem
      disableTransitionOnChange
      value={{
        midnight: 'midnight',
        'soft-light': 'soft-light',
        dim: 'dim',
        sunset: 'sunset',
        light: 'soft-light',
        dark: 'midnight',
      }}
    >
      {children}
    </NextThemesProvider>
  )
}
