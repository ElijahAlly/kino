/**
 * In-memory token store for the download flow.
 *
 * The browser can't send custom headers when navigating to a URL for download,
 * so we issue a short-lived token from POST /api/download/prepare and the
 * GET /api/download endpoint looks it up. Tokens are single-use and expire
 * after 60 seconds (enough time to actually start the download).
 *
 * In-memory is fine: this endpoint only runs on the user's MacBook (Vercel
 * is blocked because ffmpeg can't run there).
 */

interface DlEntry {
  link: string
  filename: string
  bytes: number
  expiry: number
}

const tokens = new Map<string, DlEntry>()

function sweep() {
  const now = Date.now()
  for (const [k, v] of tokens) if (v.expiry < now) tokens.delete(k)
}

export const dlTokens = {
  put(token: string, entry: Omit<DlEntry, 'expiry'>, ttlMs = 60_000) {
    tokens.set(token, { ...entry, expiry: Date.now() + ttlMs })
    sweep()
  },
  take(token: string): DlEntry | null {
    sweep()
    const e = tokens.get(token)
    if (!e) return null
    tokens.delete(token)
    return e
  },
}

export function randomToken(): string {
  // 16 bytes hex = 32 chars
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}
