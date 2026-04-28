import { unrestrictLink } from '~/server/utils/rd'

/**
 * Resolve a TMDB title (via IMDb ID) to a Real-Debrid-cached stream.
 *
 * Modes (controlled by body params):
 *   - mode: 'play'   → return direct URL + filename + filesize ready for the
 *                      browser <video> element. Filters streams to a
 *                      browser-friendly codec by default (H.264) so Safari and
 *                      Chrome can decode them without local transcoding.
 *   - mode: 'add'    → just add to RD; don't bother resolving the URL. Used
 *                      for the quiet "Add to Library" button.
 *   - default        → backwards-compatible: return URL + title.
 *
 * preferCodec: 'h264' (default for play) | 'any' — controls Torrentio stream
 * filtering. Set to 'any' for downloads (we re-encode HEVC → hvc1 in ffmpeg).
 *
 * Returns a small ledger of attempts when nothing matches, so the UI can
 * explain *why* (no streams, none cached, no H.264 cached, etc.).
 */

interface WatchBody {
  imdbId?: string
  season?: number
  episode?: number
  mode?: 'play' | 'add' | 'download'
  preferCodec?: 'h264' | 'any'
}

interface TorrentioStream {
  name?: string
  title?: string
  url?: string
  infoHash?: string
  fileIdx?: number
  behaviorHints?: { bingeGroup?: string; videoSize?: number; filename?: string }
}

async function followRedirects(url: string, maxHops = 10): Promise<{ finalUrl: string; rdHosterLink: string | null }> {
  let currentUrl = url
  let rdHosterLink: string | null = null
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(currentUrl, { redirect: 'manual' })
    const location = res.headers.get('location')
    if (!location) return { finalUrl: currentUrl, rdHosterLink }
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href
    // Capture the canonical RD hoster link from the redirect chain so we can
    // re-unrestrict later (download flow needs a fresh URL each time).
    if (!rdHosterLink && /^https:\/\/real-debrid\.com\/d\//.test(currentUrl)) {
      rdHosterLink = currentUrl
    }
  }
  return { finalUrl: currentUrl, rdHosterLink }
}

// Heuristic codec detection from a Torrentio stream title. Torrentio puts the
// raw release name in `title`; we look for canonical encoder tags. False
// positives are rare because release groups uniformly use these tokens.
function isH264(title: string): boolean {
  const t = title.toLowerCase()
  if (/\b(x265|h\.?265|hevc)\b/.test(t)) return false
  return /\b(x264|h\.?264|avc|avc1)\b/.test(t)
}

function streamFilenameFromTitle(title: string): string {
  // Torrentio's `title` field looks like:
  //   "Pluribus.S01E05.1080p.WEB.x265-Group\n👤 12 💾 1.6 GB ⚙️ ..."
  // The first line is the release name; later lines are stats. Grab line 1.
  return title.split('\n')[0].trim()
}

export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = (await readBody(event)) as WatchBody
  const { imdbId, season, episode } = body || {}
  const mode = body?.mode ?? 'add'
  const preferCodec = body?.preferCodec ?? (mode === 'play' ? 'h264' : 'any')

  if (!imdbId) {
    throw createError({ statusCode: 400, message: 'Missing required field: imdbId' })
  }

  const rdToken = process.env.RD_TOKEN
  if (!rdToken) {
    return { success: false, error: 'Server missing RD_TOKEN env var' }
  }

  const config = `qualityfilter=unknown,threed,cam,scr,brremux,hdrall,other,480p,4k|realdebrid=${rdToken}`
  const base = `https://torrentio.strem.fun/${config}`

  const streamUrl = season !== undefined && episode !== undefined
    ? `${base}/stream/series/${imdbId}:${season}:${episode}.json`
    : `${base}/stream/movie/${imdbId}.json`

  let streams: TorrentioStream[] = []
  try {
    const res = await fetch(streamUrl)
    if (!res.ok) return { success: false, error: `Torrentio HTTP ${res.status}` }
    const data = await res.json() as { streams?: TorrentioStream[] }
    streams = Array.isArray(data?.streams) ? data.streams : []
  } catch (err: any) {
    return { success: false, error: `Torrentio request failed: ${err.message}` }
  }

  if (streams.length === 0) {
    return { success: false, error: 'No streams found (title may not be cached on RD)' }
  }

  // Apply codec filter. If everything filters out and the user wanted H.264,
  // fail loudly instead of silently falling back to HEVC — Safari can't play
  // it and we'd rather tell the user than have the <video> element error.
  let candidates = streams
  if (preferCodec === 'h264') {
    candidates = streams.filter(s => isH264(s.title || ''))
    if (candidates.length === 0) {
      return {
        success: false,
        error: 'No H.264 streams cached on RD for this title. Try downloading instead — the download flow re-encodes HEVC for compatibility.',
      }
    }
  }

  // For 'add' mode we just want to seed RD with the magnet; following the top
  // candidate's redirect chain is enough. We don't need the unrestricted URL.
  if (mode === 'add') {
    const top = candidates[0]
    if (!top?.url) return { success: false, error: 'Top candidate has no URL' }
    try {
      const { finalUrl } = await followRedirects(top.url)
      const isRD = finalUrl.includes('real-debrid.com')
      if (isRD) return { success: true, title: top.title || '', url: finalUrl }
      return { success: false, error: 'Stream not cached on RD' }
    } catch (err: any) {
      return { success: false, error: `Resolve failed: ${err.message}` }
    }
  }

  // For 'play' / 'download' modes we want everything the client needs to skip
  // a library round-trip. Try up to 3 candidates so we don't add an unbounded
  // number of unrelated torrents to the RD account on misses.
  const attempts: string[] = []
  const maxTries = Math.min(candidates.length, 3)
  for (let i = 0; i < maxTries; i++) {
    const stream = candidates[i]
    if (!stream.url) continue
    try {
      const { finalUrl, rdHosterLink } = await followRedirects(stream.url)
      const isRD = finalUrl.includes('real-debrid.com')
      attempts.push(`${(stream.title || '?').slice(0, 50)} → ${isRD ? 'RD ✓' : 'not cached'}`)
      if (!isRD) continue

      // Best-effort enrich with filename + filesize. We have the hoster link
      // when we captured one mid-chain; otherwise use the title heuristic.
      let filename = streamFilenameFromTitle(stream.title || '')
      let filesize = stream.behaviorHints?.videoSize ?? 0
      if (rdHosterLink) {
        try {
          const meta = await unrestrictLink(rdHosterLink)
          filename = meta.filename || filename
          filesize = meta.filesize || filesize
        } catch {
          // unrestrict failed — fall back to whatever we have. The direct URL
          // we already followed-to is still valid for ~hours.
        }
      }

      return {
        success: true,
        title: stream.title || '',
        url: finalUrl,
        filename,
        filesize,
        hosterLink: rdHosterLink,
      }
    } catch (err: any) {
      attempts.push(`hop error: ${err.message}`)
    }
  }

  return {
    success: false,
    error: `${candidates.length} candidate stream(s), none cached on RD`,
    attempts,
  }
})
