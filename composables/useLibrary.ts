/**
 * Library backed by Real-Debrid (server resolves filenames → TMDB).
 *
 * Two-layer cache for instant render + fresh data:
 *   1. localStorage holds the last sync result → first paint is instant.
 *   2. On mount we trigger a background resync; toasts on start + finish.
 *
 * Manual sync button calls syncNow(), which is a no-op while a sync is running.
 */

export interface FileRef {
  torrentId: string
  fileId: number
  link: string
  bytes: number
  filename: string
}

export interface LibraryMovie {
  tmdbId: number
  imdbId: string | null
  title: string
  year: number | null
  posterPath: string | null
  runtime: number | null
  file: FileRef
  addedAt: number
}

export interface LibraryEpisode {
  season: number
  episode: number
  name: string | null
  runtime: number | null
  stillPath: string | null
  file: FileRef
}

export interface LibraryShow {
  tmdbId: number
  imdbId: string | null
  title: string
  posterPath: string | null
  episodes: LibraryEpisode[]
  addedAt: number
}

export interface UnmatchedItem {
  filename: string
  parsed: {
    title: string
    year: number | null
    season: number | null
    episode: number | null
    type: string
  }
  file: FileRef
}

export interface LibraryData {
  movies: LibraryMovie[]
  tv: LibraryShow[]
  unmatched: UnmatchedItem[]
  syncedAt: number
}

export type Override = { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number }
export type OverrideMap = Record<string, Override>

const STORAGE_KEY = 'kino-library-v2'
const OVERRIDES_KEY = 'kino-overrides'

const empty: LibraryData = { movies: [], tv: [], unmatched: [], syncedAt: 0 }

function readCache(): LibraryData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    return {
      movies: Array.isArray(parsed.movies) ? parsed.movies : [],
      tv: Array.isArray(parsed.tv) ? parsed.tv : [],
      unmatched: Array.isArray(parsed.unmatched) ? parsed.unmatched : [],
      syncedAt: parsed.syncedAt || 0,
    }
  } catch {
    return empty
  }
}

function writeCache(data: LibraryData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function readOverrides(): OverrideMap {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeOverrides(o: OverrideMap) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o))
  } catch {}
}

export function useLibrary() {
  const library = useState<LibraryData>('library', () => {
    if (import.meta.server) return empty
    return readCache()
  })
  const syncing = useState<boolean>('library-syncing', () => false)
  const lastSyncError = useState<string | null>('library-sync-error', () => null)

  const { ensureAuth, clearAuth } = useAuth()
  const { showToast } = useToast()

  async function syncNow(opts?: { silent?: boolean }): Promise<void> {
    if (syncing.value) return
    const secret = await ensureAuth()
    if (!secret) return

    syncing.value = true
    lastSyncError.value = null
    if (!opts?.silent) showToast('Syncing library…', 'info')

    try {
      const overrides = readOverrides()
      const data = await $fetch<LibraryData>('/api/library/sync', {
        method: 'POST',
        headers: { 'X-App-Secret': secret },
        body: { overrides },
        // Sync can take a while on first run.
        timeout: 120000,
      })
      library.value = data
      writeCache(data)
      if (!opts?.silent) showToast('Sync complete', 'success')
    } catch (err: any) {
      const status = err.status || err.statusCode
      if (status === 401) {
        clearAuth()
        showToast('Invalid passphrase.', 'error')
      } else {
        lastSyncError.value = err.message || 'Sync failed'
        showToast('Sync failed', 'error')
      }
    } finally {
      syncing.value = false
    }
  }

  function setOverride(file: FileRef, override: Override) {
    const overrides = readOverrides()
    overrides[`${file.torrentId}:${file.fileId}`] = override
    writeOverrides(overrides)
  }

  function clearOverride(file: FileRef) {
    const overrides = readOverrides()
    delete overrides[`${file.torrentId}:${file.fileId}`]
    writeOverrides(overrides)
  }

  function isInLibrary(tmdbId: number, type?: 'movie' | 'tv'): boolean {
    if (type === 'movie' || type == null) {
      if (library.value.movies.some(m => m.tmdbId === tmdbId)) return true
    }
    if (type === 'tv' || type == null) {
      if (library.value.tv.some(s => s.tmdbId === tmdbId)) return true
    }
    return false
  }

  function findShow(tmdbId: number): LibraryShow | null {
    return library.value.tv.find(s => s.tmdbId === tmdbId) || null
  }

  function findMovie(tmdbId: number): LibraryMovie | null {
    return library.value.movies.find(m => m.tmdbId === tmdbId) || null
  }

  function hasEpisode(tmdbId: number, season: number, episode: number): boolean {
    const show = findShow(tmdbId)
    if (!show) return false
    return show.episodes.some(e => e.season === season && e.episode === episode)
  }

  return {
    library,
    syncing,
    lastSyncError,
    syncNow,
    setOverride,
    clearOverride,
    isInLibrary,
    findShow,
    findMovie,
    hasEpisode,
  }
}
