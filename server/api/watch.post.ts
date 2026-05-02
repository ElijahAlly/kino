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

// Detect packed-archive payloads (RAR/ZIP/etc.) by URL or filename. RD
// occasionally returns these because the underlying torrent ships the video
// inside a `.rar`. Browsers can't play them, ffmpeg can't read them, and the
// only useful thing is to skip and try the next cached candidate.
const ARCHIVE_EXT_RE = /\.(rar|r\d{2}|zip|7z|tar|gz|bz2|iso|cab)(?:\?|$)/i
function isArchive(urlOrName: string): boolean {
  if (!urlOrName) return false
  try {
    const path = new URL(urlOrName).pathname
    return ARCHIVE_EXT_RE.test(path)
  } catch {
    return ARCHIVE_EXT_RE.test(urlOrName)
  }
}

// Heuristic codec detection from a Torrentio stream title. Torrentio puts the
// raw release name in `title`; we look for canonical encoder tags. False
// positives are rare because release groups uniformly use these tokens.
function isH264(title: string): boolean {
  const t = title.toLowerCase()
  if (/\b(x265|h\.?265|hevc)\b/.test(t)) return false
  return /\b(x264|h\.?264|avc|avc1)\b/.test(t)
}

// Reject titles whose audio codec the browser can't decode. Firefox in
// particular ships no AC3/EAC3/DTS/TrueHD support, and Chrome's coverage is
// patchy — silent video is a worse UX than picking a different cached
// candidate. AAC is universally supported, so we treat it as the gate. When
// no audio tag is present we let the candidate through (release name didn't
// say either way).
function hasBrowserAudio(title: string): boolean {
  const t = title.toLowerCase()
  // Atmos/TrueHD frequently ride on top of EAC3 but encode-only either way.
  if (/\b(ac-?3|e-?ac-?3|dts(?:[-. ]?hd)?(?:[-. ]?ma)?|truehd|atmos)\b/.test(t)) return false
  return true
}

function isBrowserPlayable(title: string): boolean {
  return isH264(title) && hasBrowserAudio(title)
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
  // 'add' seeds the library, which is for browser playback — default it to
  // the same h264 filter as 'play' so we never cache an HEVC/AC3 file the
  // <video> element can't decode. 'download' stays on 'any' because the
  // download flow re-encodes anything the browser wouldn't accept.
  const preferCodec = body?.preferCodec ?? (mode === 'download' ? 'any' : 'h264')

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

  // Apply codec filter. If everything filters out and the user wanted a
  // browser-playable file, fail loudly instead of silently falling back to
  // HEVC/AC3 — we'd rather tell the user than have the <video> element error
  // or play silently.
  let candidates = streams
  if (preferCodec === 'h264') {
    // Two-tier: prefer titles with browser-friendly audio AND H.264 video.
    // If none match, fall back to H.264 video alone — better to risk silent
    // audio than not play at all (some releases don't tag audio in the title).
    const strict = streams.filter(s => isBrowserPlayable(s.title || ''))
    candidates = strict.length > 0 ? strict : streams.filter(s => isH264(s.title || ''))
    if (candidates.length === 0) {
      return {
        success: false,
        error: 'No browser-playable streams cached on RD for this title. Try downloading instead — the download flow re-encodes HEVC/AC3 for compatibility.',
      }
    }
  }

  // For 'add' mode we just want to seed RD with the magnet; following the top
  // candidate's redirect chain is enough. We don't need the unrestricted URL,
  // but we still want to walk past archive-packed candidates (.rar etc.) so the
  // library doesn't fill up with titles that can't be played.
  if (mode === 'add') {
    const addAttempts: string[] = []
    const addMaxTries = Math.min(candidates.length, 3)
    for (let i = 0; i < addMaxTries; i++) {
      const stream = candidates[i]
      if (!stream?.url) continue
      try {
        const { finalUrl } = await followRedirects(stream.url)
        const isRD = finalUrl.includes('real-debrid.com')
        if (!isRD) {
          addAttempts.push(`${(stream.title || '?').slice(0, 50)} → not cached`)
          continue
        }
        if (isArchive(finalUrl)) {
          addAttempts.push(`${(stream.title || '?').slice(0, 50)} → packed archive, skipping`)
          continue
        }
        return { success: true, title: stream.title || '', url: finalUrl }
      } catch (err: any) {
        addAttempts.push(`hop error: ${err.message}`)
      }
    }
    return {
      success: false,
      error: 'No playable stream found for this title (cached candidates were packed archives or not on RD).',
      attempts: addAttempts,
    }
  }

  // For 'play' / 'download' modes we want everything the client needs to skip
  // a library round-trip. Try up to 3 candidates so we don't add an unbounded
  // number of unrelated torrents to the RD account on misses.
  const attempts: string[] = []
  const maxTries = Math.min(candidates.length, 3)
  let archiveSkipped = 0
  for (let i = 0; i < maxTries; i++) {
    const stream = candidates[i]
    if (!stream.url) continue
    try {
      const { finalUrl, rdHosterLink } = await followRedirects(stream.url)
      const isRD = finalUrl.includes('real-debrid.com')
      attempts.push(`${(stream.title || '?').slice(0, 50)} → ${isRD ? 'RD ✓' : 'not cached'}`)
      if (!isRD) continue

      // Reject packed archives — `.rar` etc. are not playable in <video> and
      // ffmpeg can't read them. Try the next candidate instead of returning a
      // URL the user will only see fail with "File format isn't supported".
      if (isArchive(finalUrl)) {
        archiveSkipped++
        attempts[attempts.length - 1] += ' (packed archive, skipped)'
        continue
      }

      // Best-effort enrich with filename + filesize. We have the hoster link
      // when we captured one mid-chain; otherwise use the title heuristic.
      let filename = streamFilenameFromTitle(stream.title || '')
      let filesize = stream.behaviorHints?.videoSize ?? 0
      if (rdHosterLink) {
        try {
          const meta = await unrestrictLink(rdHosterLink)
          filename = meta.filename || filename
          filesize = meta.filesize || filesize
          // Some hosters report a video URL but the actual unrestricted
          // download is the archive. Catch that here too.
          if (isArchive(meta.download) || isArchive(meta.filename || '')) {
            archiveSkipped++
            attempts[attempts.length - 1] += ' (packed archive on unrestrict, skipped)'
            continue
          }
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

  const reason = archiveSkipped > 0
    ? `No playable stream found — ${archiveSkipped} cached candidate${archiveSkipped > 1 ? 's were' : ' was'} packed in an archive (.rar) the browser can't play. Try downloading instead, or pick another title.`
    : `${candidates.length} candidate stream(s), none cached on RD`
  return {
    success: false,
    error: reason,
    attempts,
  }
})
