import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// Required for Supabase SSL — their pooler uses a self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

function createPrismaClient() {
  const connectionString =
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    'postgresql://localhost:5432/ghl_agent'

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({
    adapter,
    log: ['error'],
  })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
