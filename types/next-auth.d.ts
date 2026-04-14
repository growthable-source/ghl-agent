import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      onboardingCompletedAt: string | null
    } & DefaultSession['user']
  }
}
