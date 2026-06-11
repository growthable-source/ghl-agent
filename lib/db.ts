import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

function createPrismaClient() {
  const connectionString =
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    'postgresql://localhost:5432/ghl_agent'

  // Connection caps matter on Vercel: each warm serverless instance
  // holds its own pool, and Postgres has a hard connection ceiling
  // (Supabase poolers and managed PG default ~60–100). An unbounded
  // pool lets a traffic spike open connections until the DB refuses
  // new ones — every request then times out, a full outage from load
  // alone. Keep each instance small; concurrency across instances is
  // what fills the DB, so per-instance max stays low.
  //   - max 5:   plenty for one function's concurrent queries
  //   - idleTimeoutMillis 10s: release idle conns fast so scaled-down
  //     instances don't pin connections the DB could give elsewhere
  //   - connectionTimeoutMillis 10s: fail fast with a clear error
  //     instead of hanging the request when the DB is saturated
  // Override via PG_POOL_MAX for a bursty workload on a bigger DB.
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
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
