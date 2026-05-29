/**
 * Friendly random-name generator — the kind of placeholder you see in
 * Google Docs when an anonymous user joins ("Curious Llama", "Eager
 * Otter"). Used as the default name for newly-created agents so the
 * agents list has personality from the first click instead of a wall
 * of "New Inbound Agent" / "Outbound Sales Agent" duplicates.
 *
 * Pure: no DB, no randomness state. Each call returns "<Adjective> <Animal>"
 * sourced from the two lists below. With ~60 of each, collision risk inside
 * a workspace is small enough we don't bother de-duplicating against
 * existing names — and a rare collision still produces a readable string.
 *
 * Selection:
 *   - Uses `crypto.getRandomValues` when available (browser + modern Node)
 *     so output is unbiased and not seeded off `Math.random()`.
 *   - Falls back to `Math.random()` in environments without WebCrypto.
 *     The generator must work in both the wizard (client component) and
 *     the API route (Node server), hence the dual-mode pick.
 */

// Adjective list — friendly, professional-ish, evocative. Deliberately
// avoids anything ambiguous, snarky, or negative. Keep additions to a
// single English word, lowercase here; we Title-Case at format time.
const ADJECTIVES = [
  'curious', 'eager', 'bold', 'bright', 'calm', 'clever', 'cosmic',
  'daring', 'dapper', 'dazzling', 'electric', 'fearless', 'feisty',
  'friendly', 'gallant', 'gentle', 'happy', 'humble', 'jolly', 'joyful',
  'kind', 'lively', 'loyal', 'lucky', 'mellow', 'merry', 'mighty',
  'noble', 'peaceful', 'plucky', 'polished', 'proud', 'quick', 'quiet',
  'radiant', 'rapid', 'ready', 'sharp', 'sincere', 'sleek', 'smiling',
  'snappy', 'sparkling', 'spirited', 'splendid', 'steady', 'sunny',
  'swift', 'thoughtful', 'tidy', 'trusty', 'upbeat', 'vibrant', 'vivid',
  'warm', 'witty', 'wonderful', 'zealous', 'zen', 'zippy',
]

// Animal list — recognizable, friendly, non-threatening. Same rules as
// adjectives: single lowercase word, Title-Cased at format time.
const ANIMALS = [
  'llama', 'otter', 'panda', 'fox', 'badger', 'beaver', 'rabbit',
  'squirrel', 'hedgehog', 'koala', 'kangaroo', 'wombat', 'capybara',
  'meerkat', 'lemur', 'sloth', 'platypus', 'puffin', 'penguin', 'pelican',
  'flamingo', 'heron', 'swan', 'owl', 'falcon', 'sparrow', 'robin',
  'magpie', 'parrot', 'macaw', 'toucan', 'dolphin', 'narwhal', 'orca',
  'walrus', 'seal', 'turtle', 'tortoise', 'gecko', 'iguana', 'chameleon',
  'octopus', 'cuttlefish', 'starfish', 'seahorse', 'butterfly', 'firefly',
  'bumblebee', 'ladybug', 'dragonfly', 'mantis', 'cricket', 'caterpillar',
  'wolf', 'lynx', 'cheetah', 'leopard', 'jaguar', 'tiger', 'bison',
  'moose', 'elk', 'deer', 'antelope', 'gazelle',
]

function pickIndex(modulus: number): number {
  // Prefer WebCrypto for unbiased randomness. `crypto` is a global in
  // modern Node (>=19) and in browsers, so we duck-type rather than
  // import 'node:crypto' (which would break the wizard bundle).
  const g: { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } } =
    typeof globalThis !== 'undefined' ? (globalThis as any) : ({} as any)
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1)
    g.crypto.getRandomValues(buf)
    return buf[0] % modulus
  }
  return Math.floor(Math.random() * modulus)
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Returns a fresh "<Adjective> <Animal>" name, e.g. "Curious Llama".
 * Safe to call in either client or server code.
 */
export function generateAgentName(): string {
  const adj = ADJECTIVES[pickIndex(ADJECTIVES.length)]
  const animal = ANIMALS[pickIndex(ANIMALS.length)]
  return `${titleCase(adj)} ${titleCase(animal)}`
}

/**
 * Server-side default helper: pass through a caller-supplied name if it
 * has any non-whitespace content; otherwise generate one. Keeps the
 * "name comes from request body" contract intact for callers that DO
 * provide a name (templates, duplicates, the wizard once we wire it up)
 * while ensuring nothing creates a blank-named agent.
 */
export function defaultAgentName(supplied: unknown): string {
  if (typeof supplied === 'string' && supplied.trim().length > 0) {
    return supplied.trim()
  }
  return generateAgentName()
}

// Exposed for tests / future tooling.
export const __AGENT_NAME_INTERNALS = { ADJECTIVES, ANIMALS }
