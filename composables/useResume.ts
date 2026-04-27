/**
 * Resume position tracking, keyed by tmdbId (+ season/episode for TV).
 *
 * Stored in localStorage under "kino-resume-v1" as a single JSON map so
 * we can read/write the whole thing cheaply during playback.
 */

export interface ResumePoint {
  position: number
  duration: number
  updatedAt: number
}

const KEY = 'kino-resume-v1'

function read(): Record<string, ResumePoint> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

function write(map: Record<string, ResumePoint>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {}
}

function makeKey(tmdbId: number, season?: number, episode?: number): string {
  if (season != null && episode != null) return `${tmdbId}:${season}:${episode}`
  return `${tmdbId}`
}

export function useResume() {
  function get(tmdbId: number, season?: number, episode?: number): ResumePoint | null {
    const map = read()
    return map[makeKey(tmdbId, season, episode)] || null
  }

  function set(tmdbId: number, position: number, duration: number, season?: number, episode?: number) {
    const map = read()
    // If user is within 30s of the end, treat as finished and clear the resume point.
    if (duration > 0 && duration - position < 30) {
      delete map[makeKey(tmdbId, season, episode)]
    } else {
      map[makeKey(tmdbId, season, episode)] = {
        position,
        duration,
        updatedAt: Date.now(),
      }
    }
    write(map)
  }

  function clear(tmdbId: number, season?: number, episode?: number) {
    const map = read()
    delete map[makeKey(tmdbId, season, episode)]
    write(map)
  }

  function progress(tmdbId: number, season?: number, episode?: number): number {
    const p = get(tmdbId, season, episode)
    if (!p || !p.duration) return 0
    return Math.min(1, p.position / p.duration)
  }

  return { get, set, clear, progress }
}
