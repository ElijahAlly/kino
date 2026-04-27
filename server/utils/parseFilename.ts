/**
 * Parse a torrent / release filename into title, year, season, episode.
 * Handles ~95% of standard scene release patterns. Falls back to type "unknown"
 * when nothing useful can be extracted — UI shows a fix-match button for those.
 */

export interface ParsedFilename {
  title: string
  year: number | null
  season: number | null
  episode: number | null
  resolution: string | null
  type: 'movie' | 'tv' | 'unknown'
}

const RES_RE = /\b(2160p|1080p|720p|480p|4k|8k)\b/i
const SE_RE = /[Ss](\d{1,2})[Ee](\d{1,3})/
const SE_ALT_RE = /\b(\d{1,2})x(\d{1,3})\b/
const SEASON_ONLY_RE = /[Ss](\d{1,2})(?![Ee\d])/
const YEAR_RE = /\b((?:19|20)\d{2})\b/

export function parseFilename(raw: string): ParsedFilename {
  // strip extension
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, '')
  // strip tracker URL prefixes like "www.something.org    -    " before
  // normalizing dots-to-spaces. Anchored to "www." to avoid eating into
  // normal release names that contain hyphens (e.g. "WEB-DL", "H264-Group").
  s = s.replace(/^www\.[a-z0-9-]+\.[a-z]{2,5}\s*-\s*/i, '').trim()
  s = s.replace(/^\[[^\]]+\]\s*/, '').trim()
  // normalize separators
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()

  let cutAt = s.length

  let season: number | null = null
  let episode: number | null = null
  const seMatch = s.match(SE_RE) || s.match(SE_ALT_RE)
  if (seMatch) {
    season = parseInt(seMatch[1], 10)
    episode = parseInt(seMatch[2], 10)
    cutAt = Math.min(cutAt, seMatch.index!)
  } else {
    const seasonOnly = s.match(SEASON_ONLY_RE)
    if (seasonOnly) {
      season = parseInt(seasonOnly[1], 10)
      cutAt = Math.min(cutAt, seasonOnly.index!)
    }
  }

  let year: number | null = null
  const yearMatch = s.match(YEAR_RE)
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10)
    cutAt = Math.min(cutAt, yearMatch.index!)
  }

  const resMatch = s.match(RES_RE)
  const resolution = resMatch ? resMatch[1].toLowerCase() : null
  if (resMatch) cutAt = Math.min(cutAt, resMatch.index!)

  let title = s.slice(0, cutAt).trim()
  title = title.replace(/[\s\-_.()[\]]+$/, '').trim()
  // strip leading "[Group]" tags
  title = title.replace(/^\[[^\]]+\]\s*/, '').trim()

  let type: 'movie' | 'tv' | 'unknown' = 'unknown'
  if (episode !== null) type = 'tv'
  else if (season !== null) type = 'tv'
  else if (title) type = 'movie'

  return { title, year, season, episode, resolution, type }
}
