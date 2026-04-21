#!/usr/bin/env node
/**
 * Create or reset a super-admin account.
 *
 * Usage:
 *   node scripts/create-admin.mjs
 *
 * Prompts for email, name, and password. Bcrypts the password (cost 12)
 * and upserts a SuperAdmin row. Running for an existing email resets
 * the password in place — useful for "I locked myself out".
 *
 * Requires DATABASE_URL in the environment (load .env.local first if
 * needed). The script shells out to nothing — pure Prisma + bcrypt.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const rl = createInterface({ input, output })

// Avoid echoing passwords. readline doesn't have a muted mode built in,
// so we go the lowlevel route: disable echo during the prompt.
async function askPassword(prompt) {
  const wasRaw = input.isRaw
  try {
    output.write(prompt)
    input.setRawMode?.(true)
    const chars = []
    await new Promise(resolve => {
      const onData = (chunk) => {
        for (const byte of chunk) {
          // Enter
          if (byte === 13 || byte === 10) {
            input.off('data', onData)
            output.write('\n')
            resolve()
            return
          }
          // Ctrl-C
          if (byte === 3) {
            input.off('data', onData)
            output.write('\n')
            process.exit(1)
          }
          // Backspace / delete
          if (byte === 127 || byte === 8) {
            if (chars.length > 0) chars.pop()
            continue
          }
          chars.push(String.fromCharCode(byte))
        }
      }
      input.on('data', onData)
    })
    return chars.join('')
  } finally {
    input.setRawMode?.(wasRaw ?? false)
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('\nDATABASE_URL is not set. Load .env.local first:\n')
    console.error('  env $(cat .env.local | xargs) node scripts/create-admin.mjs\n')
    process.exit(1)
  }

  console.log('\nVoxility super-admin bootstrap\n')
  const emailRaw = (await rl.question('Email: ')).trim().toLowerCase()
  if (!emailRaw || !emailRaw.includes('@')) {
    console.error('Invalid email.')
    process.exit(1)
  }

  const name = (await rl.question('Name (optional): ')).trim() || null

  const password = await askPassword('Password: ')
  if (password.length < 10) {
    console.error('\nPassword must be at least 10 characters.')
    process.exit(1)
  }
  const confirm = await askPassword('Confirm:  ')
  if (password !== confirm) {
    console.error('\nPasswords do not match.')
    process.exit(1)
  }

  const db = new PrismaClient()
  try {
    const hash = await bcrypt.hash(password, 12)
    const existing = await db.superAdmin.findUnique({ where: { email: emailRaw } })
    const admin = await db.superAdmin.upsert({
      where: { email: emailRaw },
      create: { email: emailRaw, name, passwordHash: hash, isActive: true },
      update: { passwordHash: hash, name, isActive: true },
    })

    console.log(`\n✓ ${existing ? 'Updated' : 'Created'} super-admin ${admin.email} (id: ${admin.id})`)
    console.log(`  Sign in at /admin/login\n`)
  } catch (err) {
    console.error('\nFailed:', err.message)
    process.exit(1)
  } finally {
    await db.$disconnect()
    rl.close()
  }
}

main()
