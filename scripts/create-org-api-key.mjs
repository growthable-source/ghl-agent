// scripts/create-org-api-key.mjs
// Usage: node scripts/create-org-api-key.mjs "Operations Dashboard"
// Mints a single org-scope API key. The raw key is printed ONCE — store it now.
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const base62 = (buf) => [...buf].map((b) => ALPHABET[b % 62]).join('')
const raw = `vox_live_${base62(randomBytes(32))}`
const hashed = createHash('sha256').update(raw).digest('hex')

const db = new PrismaClient()
const name = process.argv[2] || 'Org Operations Key'
await db.apiKey.create({ data: { scope: 'org', workspaceId: null, name, prefix: raw.slice(0, 12), hashedKey: hashed } })
console.log('\nOrg API key (store now — shown once):\n')
console.log('  ' + raw + '\n')
await db.$disconnect()
