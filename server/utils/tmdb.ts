/**
 * TMDB lookup helpers with per-request memoization.
 *
 * One sync re-runs every page load, so we keep this simple:
 *   - In-memory cache scoped to one request (dedupes within a sync).
 *   - Client-side localStorage caches the *enriched library*, not raw TMDB,
 *     which means a second-page-load shows instantly without TMDB hits.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3'

function apiKey(): string {
  const k = process.env.TMDB_API_KEY
  if (!k) throw new Error('TMDB_API_KEY not configured')
  return k
}

export interface TmdbMovie {
  id: number
  imdb_id: string | null
  title: string
  release_date: string | null
  poster_path: string | null
  runtime: number | null
}

export interface TmdbTv {
  id: number
  name: string
  first_air_date: string | null
  poster_path: string | null
  external_ids?: { imdb_id: string | null }
}

export interface TmdbEpisode {
  episode_number: number
  name: string
  runtime: number | null
  overview?: string
  still_path?: string | null
}

export interface TmdbSeason {
  season_number: number
  episodes: TmdbEpisode[]
}

/**
 * Reject TMDB search results that don't actually match the parsed filename.
 *
 * Why: a filename like "Wicked.S01E03.1080p.mkv" parses to title="Wicked",
 * which TMDB returns dozens of matches for (including unrelated/adult titles
 * that beat the real one on popularity). Taking results[0] blindly is how
 * "ghost films" appeared in the user's library.
 *
 * Rules:
 *   - normalize both sides to lowercase letters/digits
 *   - require the parsed title to be a prefix or strong substring of the
 *     candidate's TMDB title (or vice-versa for short titles)
 *   - if a year was parsed, prefer candidates within ±1 year, drop those
 *     more than 2 years off
 */
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function pickBestResult<T extends { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string }>(
  results: T[],
  parsedTitle: string,
  parsedYear: number | null,
  isTv: boolean,
): T | null {
  if (!results.length) return null
  const wanted = normalizeTitle(parsedTitle)
  if (!wanted) return null

  const scored: { r: T; score: number }[] = []
  for (const r of results) {
    const tmdbTitle = isTv ? (r.name || '') : (r.title || '')
    const got = normalizeTitle(tmdbTitle)
    if (!got) continue

    // Title must overlap meaningfully. Prefix match in either direction
    // covers "Pluribus" ↔ "Pluribus" and "The Matrix" ↔ "Matrix" cases
    // without admitting "Witchcraft 2" when we wanted "Wicked".
    const prefixMatch = got.startsWith(wanted) || wanted.startsWith(got)
    const containsMatch = got.includes(wanted) || wanted.includes(got)
    if (!prefixMatch && !containsMatch) continue

    let score = 0
    if (got === wanted) score += 100
    else if (prefixMatch) score += 50
    else score += 10

    const dateStr = isTv ? r.first_air_date : r.release_date
    const candYear = dateStr ? Number(dateStr.slice(0, 4)) : null
    if (parsedYear && candYear) {
      const diff = Math.abs(candYear - parsedYear)
      if (diff > 2) continue // hard reject — wrong title
      if (diff === 0) score += 40
      else if (diff === 1) score += 20
    }

    scored.push({ r, score })
  }

  if (!scored.length) return null
  scored.sort((a, b) => b.score - a.score)
  return scored[0].r
}

export class TmdbCache {
  private movies = new Map<string, TmdbMovie | null>()
  private tvs = new Map<string, TmdbTv | null>()
  private seasons = new Map<string, TmdbSeason | null>()
  private fullMovies = new Map<number, TmdbMovie | null>()
  private fullTvs = new Map<number, TmdbTv | null>()

  async findMovie(title: string, year: number | null): Promise<TmdbMovie | null> {
    const key = `${title.toLowerCase()}::${year ?? ''}`
    if (this.movies.has(key)) return this.movies.get(key)!

    const params = new URLSearchParams({
      api_key: apiKey(),
      query: title,
      include_adult: 'false',
    })
    if (year) params.set('year', String(year))
    const res = await fetch(`${TMDB_BASE}/search/movie?${params}`)
    const data: any = res.ok ? await res.json() : { results: [] }
    const picked = pickBestResult(data.results || [], title, year, /* isTv */ false)
    if (!picked) {
      this.movies.set(key, null)
      return null
    }
    const full = await this.getMovie(picked.id)
    this.movies.set(key, full)
    return full
  }

  async findTv(title: string, year: number | null): Promise<TmdbTv | null> {
    const key = `${title.toLowerCase()}::${year ?? ''}`
    if (this.tvs.has(key)) return this.tvs.get(key)!

    const params = new URLSearchParams({
      api_key: apiKey(),
      query: title,
      include_adult: 'false',
    })
    if (year) params.set('first_air_date_year', String(year))
    const res = await fetch(`${TMDB_BASE}/search/tv?${params}`)
    const data: any = res.ok ? await res.json() : { results: [] }
    let picked = pickBestResult(data.results || [], title, year, /* isTv */ true)
    if (!picked && year) {
      // Retry without year — shows often air the year before/after the
      // year parsed from filenames (e.g. release-year vs first-air-year).
      const p2 = new URLSearchParams({
        api_key: apiKey(),
        query: title,
        include_adult: 'false',
      })
      const r2 = await fetch(`${TMDB_BASE}/search/tv?${p2}`)
      const d2: any = r2.ok ? await r2.json() : { results: [] }
      picked = pickBestResult(d2.results || [], title, year, /* isTv */ true)
    }
    if (!picked) {
      this.tvs.set(key, null)
      return null
    }
    const full = await this.getTv(picked.id)
    this.tvs.set(key, full)
    return full
  }

  async getMovie(id: number): Promise<TmdbMovie | null> {
    if (this.fullMovies.has(id)) return this.fullMovies.get(id)!
    const params = new URLSearchParams({ api_key: apiKey(), append_to_response: 'external_ids' })
    const res = await fetch(`${TMDB_BASE}/movie/${id}?${params}`)
    if (!res.ok) {
      this.fullMovies.set(id, null)
      return null
    }
    const data: any = await res.json()
    const out: TmdbMovie = {
      id: data.id,
      imdb_id: data.imdb_id || data.external_ids?.imdb_id || null,
      title: data.title,
      release_date: data.release_date || null,
      poster_path: data.poster_path || null,
      runtime: data.runtime ?? null,
    }
    this.fullMovies.set(id, out)
    return out
  }

  async getTv(id: number): Promise<TmdbTv | null> {
    if (this.fullTvs.has(id)) return this.fullTvs.get(id)!
    const params = new URLSearchParams({ api_key: apiKey(), append_to_response: 'external_ids' })
    const res = await fetch(`${TMDB_BASE}/tv/${id}?${params}`)
    if (!res.ok) {
      this.fullTvs.set(id, null)
      return null
    }
    const data: any = await res.json()
    const out: TmdbTv = {
      id: data.id,
      name: data.name,
      first_air_date: data.first_air_date || null,
      poster_path: data.poster_path || null,
      external_ids: { imdb_id: data.external_ids?.imdb_id || null },
    }
    this.fullTvs.set(id, out)
    return out
  }

  async getSeason(tvId: number, seasonNumber: number): Promise<TmdbSeason | null> {
    const key = `${tvId}-${seasonNumber}`
    if (this.seasons.has(key)) return this.seasons.get(key)!
    const params = new URLSearchParams({ api_key: apiKey() })
    const res = await fetch(`${TMDB_BASE}/tv/${tvId}/season/${seasonNumber}?${params}`)
    if (!res.ok) {
      this.seasons.set(key, null)
      return null
    }
    const data: any = await res.json()
    const out: TmdbSeason = {
      season_number: data.season_number,
      episodes: (data.episodes || []).map((e: any) => ({
        episode_number: e.episode_number,
        name: e.name,
        runtime: e.runtime ?? null,
        overview: e.overview,
        still_path: e.still_path,
      })),
    }
    this.seasons.set(key, out)
    return out
  }
}
