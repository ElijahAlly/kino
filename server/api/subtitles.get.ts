/**
 * Subtitle search via the free public Wyzie subs API (no auth required).
 *
 *   https://sub.wyzie.ru/search?id=tt1234567               → movies
 *   https://sub.wyzie.ru/search?id=tt1234567&season=1&episode=2  → episodes
 *
 * Returns a deduped, normalized list of tracks the Player can request through
 * /api/subtitle (which converts SRT/ASS to WebVTT for the <track> element).
 *
 * We *don't* require the app secret here — subtitles are public and the
 * passphrase gate is only meaningful for RD-cost flows.
 */

interface WyzieSub {
  id?: string
  url: string
  format?: string          // 'srt' | 'vtt' | 'ass' | 'ssa'
  encoding?: string
  display?: string         // human label, e.g. "English"
  language?: string        // ISO code, e.g. "en"
  isHearingImpaired?: boolean
  source?: string
  media?: string
}

export interface SubtitleTrack {
  id: string
  language: string         // ISO 639-1 (or original if unknown)
  label: string            // user-facing label
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown'
  hearingImpaired: boolean
  source: string
  /** Token to pass to /api/subtitle?u= — base64-encoded URL */
  url: string
}

function classifyFormat(s?: string): SubtitleTrack['format'] {
  const f = (s || '').toLowerCase()
  if (f === 'srt' || f === 'vtt' || f === 'ass' || f === 'ssa') return f
  return 'unknown'
}

export default defineEventHandler(async (event): Promise<{ tracks: SubtitleTrack[]; error?: string }> => {
  const q = getQuery(event)
  const imdbId = String(q.imdbId || '').trim()
  const season = q.season != null ? Number(q.season) : undefined
  const episode = q.episode != null ? Number(q.episode) : undefined

  if (!imdbId || !/^tt\d+$/.test(imdbId)) {
    return { tracks: [], error: 'Invalid imdbId' }
  }

  const params = new URLSearchParams({ id: imdbId })
  if (season != null && Number.isFinite(season)) params.set('season', String(season))
  if (episode != null && Number.isFinite(episode)) params.set('episode', String(episode))

  // Wyzie sits behind Cloudflare and rejects bare server-to-server requests
  // (Vercel egress with no UA → 401). Sending a real browser UA + Referer is
  // enough to pass the bot check.
  const wyzieHeaders: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://sub.wyzie.ru/',
  }

  let raw: WyzieSub[] = []
  try {
    const res = await fetch(`https://sub.wyzie.ru/search?${params}`, {
      headers: wyzieHeaders,
    })
    if (!res.ok) return { tracks: [], error: `Subtitle search HTTP ${res.status}` }
    const data = await res.json()
    raw = Array.isArray(data) ? data : []
  } catch (err: any) {
    return { tracks: [], error: `Subtitle search failed: ${err?.message || 'unknown'}` }
  }

  // Dedupe by language+display+hearingImpaired, prefer SRT/VTT over ASS/SSA
  // (ASS has styling we can't render in <track>; we strip it but quality varies).
  const formatRank: Record<string, number> = { vtt: 0, srt: 1, ass: 2, ssa: 2, unknown: 3 }
  const seen = new Map<string, SubtitleTrack>()

  for (const s of raw) {
    if (!s?.url) continue
    const lang = (s.language || 'unknown').toLowerCase()
    const label = s.display || s.language || 'Unknown'
    const hearingImpaired = !!s.isHearingImpaired
    const format = classifyFormat(s.format)
    const key = `${lang}::${label}::${hearingImpaired}`

    const candidate: SubtitleTrack = {
      id: s.id || `${lang}-${seen.size}`,
      language: lang,
      label,
      format,
      hearingImpaired,
      source: s.source || 'unknown',
      // Pack the URL into a token so the proxy doesn't need to URL-decode oddities.
      url: Buffer.from(s.url, 'utf-8').toString('base64'),
    }

    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, candidate)
      continue
    }
    // Keep the candidate with the better format rank.
    if (formatRank[candidate.format] < formatRank[prev.format]) {
      seen.set(key, candidate)
    }
  }

  // Sort: English first, then alphabetical by label, with HI variants after their plain twin.
  const tracks = [...seen.values()].sort((a, b) => {
    const aEn = a.language.startsWith('en') ? 0 : 1
    const bEn = b.language.startsWith('en') ? 0 : 1
    if (aEn !== bEn) return aEn - bEn
    if (a.label !== b.label) return a.label.localeCompare(b.label)
    return Number(a.hearingImpaired) - Number(b.hearingImpaired)
  })

  return { tracks }
})
