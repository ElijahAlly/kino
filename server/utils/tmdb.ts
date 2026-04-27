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

export class TmdbCache {
  private movies = new Map<string, TmdbMovie | null>()
  private tvs = new Map<string, TmdbTv | null>()
  private seasons = new Map<string, TmdbSeason | null>()
  private fullMovies = new Map<number, TmdbMovie | null>()
  private fullTvs = new Map<number, TmdbTv | null>()

  async findMovie(title: string, year: number | null): Promise<TmdbMovie | null> {
    const key = `${title.toLowerCase()}::${year ?? ''}`
    if (this.movies.has(key)) return this.movies.get(key)!

    const params = new URLSearchParams({ api_key: apiKey(), query: title })
    if (year) params.set('year', String(year))
    const res = await fetch(`${TMDB_BASE}/search/movie?${params}`)
    const data: any = res.ok ? await res.json() : { results: [] }
    const top = data.results?.[0]
    if (!top) {
      this.movies.set(key, null)
      return null
    }
    const full = await this.getMovie(top.id)
    this.movies.set(key, full)
    return full
  }

  async findTv(title: string, year: number | null): Promise<TmdbTv | null> {
    const key = `${title.toLowerCase()}::${year ?? ''}`
    if (this.tvs.has(key)) return this.tvs.get(key)!

    const params = new URLSearchParams({ api_key: apiKey(), query: title })
    if (year) params.set('first_air_date_year', String(year))
    const res = await fetch(`${TMDB_BASE}/search/tv?${params}`)
    const data: any = res.ok ? await res.json() : { results: [] }
    let top = data.results?.[0]
    if (!top && year) {
      // retry without year — shows often air the year before/after their parsed-from-filename year
      const p2 = new URLSearchParams({ api_key: apiKey(), query: title })
      const r2 = await fetch(`${TMDB_BASE}/search/tv?${p2}`)
      const d2: any = r2.ok ? await r2.json() : { results: [] }
      top = d2.results?.[0]
    }
    if (!top) {
      this.tvs.set(key, null)
      return null
    }
    const full = await this.getTv(top.id)
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
