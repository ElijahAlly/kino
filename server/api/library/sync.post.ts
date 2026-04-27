import { listTorrents, getTorrentInfo, type RdTorrent } from '~/server/utils/rd'
import { parseFilename, type ParsedFilename } from '~/server/utils/parseFilename'
import { TmdbCache, type TmdbMovie, type TmdbTv } from '~/server/utils/tmdb'
import { pMap } from '~/server/utils/concurrency'

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
  parsed: ParsedFilename
  file: FileRef
}

export interface SyncResponse {
  movies: LibraryMovie[]
  tv: LibraryShow[]
  unmatched: UnmatchedItem[]
  syncedAt: number
  stats: { torrents: number; files: number; matched: number }
}

interface RawItem {
  file: FileRef
  parsed: ParsedFilename
  addedAt: number
}

type Override = { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number }
type OverrideMap = Record<string, Override>

function fileKey(torrentId: string, fileId: number) {
  return `${torrentId}:${fileId}`
}

function basename(p: string) {
  const cleaned = p.replace(/^\/+/, '')
  const slash = cleaned.lastIndexOf('/')
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned
}

async function expandTorrents(torrents: RdTorrent[]): Promise<RawItem[]> {
  const items: RawItem[] = []

  // Single-file torrents: no extra fetch needed.
  const singles = torrents.filter(t => t.links.length === 1)
  for (const t of singles) {
    const filename = t.filename || t.original_filename || 'unknown'
    items.push({
      file: {
        torrentId: t.id,
        fileId: -1,
        link: t.links[0],
        bytes: t.bytes,
        filename,
      },
      parsed: parseFilename(filename),
      addedAt: Date.parse(t.added) || Date.now(),
    })
  }

  // Multi-file torrents (season packs): expand via /torrents/info.
  const packs = torrents.filter(t => t.links.length > 1)
  const infos = await pMap(packs, t => getTorrentInfo(t.id).catch(() => null), 6)

  for (let i = 0; i < packs.length; i++) {
    const t = packs[i]
    const info = infos[i]
    if (!info) continue
    const selectedFiles = info.files.filter(f => f.selected === 1)
    // RD's links array is parallel to the *selected* files in selection order.
    if (selectedFiles.length !== info.links.length) {
      // shape doesn't match — skip rather than mismatch episodes
      continue
    }
    for (let j = 0; j < selectedFiles.length; j++) {
      const f = selectedFiles[j]
      const filename = basename(f.path)
      // Only video files
      if (!/\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i.test(filename)) continue
      items.push({
        file: {
          torrentId: t.id,
          fileId: f.id,
          link: info.links[j],
          bytes: f.bytes,
          filename,
        },
        parsed: parseFilename(filename),
        addedAt: Date.parse(t.added) || Date.now(),
      })
    }
  }

  return items
}

export default defineEventHandler(async (event): Promise<SyncResponse> => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event).catch(() => ({})) as { overrides?: OverrideMap }
  const overrides: OverrideMap = body?.overrides || {}

  const torrents = (await listTorrents()).filter(t => t.status === 'downloaded')

  const items = await expandTorrents(torrents)
  const tmdb = new TmdbCache()

  const moviesOut: LibraryMovie[] = []
  // group TV by tmdbId so episodes from multiple torrents merge into one show
  const tvMap = new Map<number, { show: TmdbTv; episodes: LibraryEpisode[]; addedAt: number }>()
  const unmatched: UnmatchedItem[] = []

  // First pass: classify and look up TMDB. Bound concurrency so we don't burst TMDB.
  await pMap(items, async (it) => {
    const k = fileKey(it.file.torrentId, it.file.fileId)
    const ovr = overrides[k]

    // Manual override takes precedence over filename parsing.
    if (ovr) {
      if (ovr.type === 'movie') {
        const movie = await tmdb.getMovie(ovr.tmdbId)
        if (movie) {
          moviesOut.push({
            tmdbId: movie.id,
            imdbId: movie.imdb_id,
            title: movie.title,
            year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
            posterPath: movie.poster_path,
            runtime: movie.runtime,
            file: it.file,
            addedAt: it.addedAt,
          })
          return
        }
      } else if (ovr.type === 'tv' && ovr.season != null && ovr.episode != null) {
        const show = await tmdb.getTv(ovr.tmdbId)
        if (show) {
          const season = await tmdb.getSeason(show.id, ovr.season)
          const epData = season?.episodes.find(e => e.episode_number === ovr.episode)
          const slot = tvMap.get(show.id) ?? { show, episodes: [], addedAt: 0 }
          slot.episodes.push({
            season: ovr.season,
            episode: ovr.episode,
            name: epData?.name ?? null,
            runtime: epData?.runtime ?? null,
            stillPath: epData?.still_path ?? null,
            file: it.file,
          })
          slot.addedAt = Math.max(slot.addedAt, it.addedAt)
          tvMap.set(show.id, slot)
          return
        }
      }
      // override target couldn't be resolved → fall through to parsed
    }

    if (it.parsed.type === 'movie' && it.parsed.title) {
      const movie = await tmdb.findMovie(it.parsed.title, it.parsed.year)
      if (movie) {
        moviesOut.push({
          tmdbId: movie.id,
          imdbId: movie.imdb_id,
          title: movie.title,
          year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
          posterPath: movie.poster_path,
          runtime: movie.runtime,
          file: it.file,
          addedAt: it.addedAt,
        })
        return
      }
    }

    if (it.parsed.type === 'tv' && it.parsed.title && it.parsed.season != null && it.parsed.episode != null) {
      const show = await tmdb.findTv(it.parsed.title, it.parsed.year)
      if (show) {
        const season = await tmdb.getSeason(show.id, it.parsed.season)
        const epData = season?.episodes.find(e => e.episode_number === it.parsed.episode)
        const slot = tvMap.get(show.id) ?? { show, episodes: [], addedAt: 0 }
        slot.episodes.push({
          season: it.parsed.season!,
          episode: it.parsed.episode!,
          name: epData?.name ?? null,
          runtime: epData?.runtime ?? null,
          stillPath: epData?.still_path ?? null,
          file: it.file,
        })
        slot.addedAt = Math.max(slot.addedAt, it.addedAt)
        tvMap.set(show.id, slot)
        return
      }
    }

    unmatched.push({
      filename: it.file.filename,
      parsed: it.parsed,
      file: it.file,
    })
  }, 6)

  // Dedupe: if RD has the same movie added twice, keep the largest file (best quality usually).
  const dedupedMovies = new Map<number, LibraryMovie>()
  for (const m of moviesOut) {
    const prev = dedupedMovies.get(m.tmdbId)
    if (!prev || m.file.bytes > prev.file.bytes) dedupedMovies.set(m.tmdbId, m)
  }

  // Dedupe episodes within each show: same season+episode → keep largest file.
  const tvOut: LibraryShow[] = []
  for (const [tmdbId, slot] of tvMap) {
    const epMap = new Map<string, LibraryEpisode>()
    for (const ep of slot.episodes) {
      const k = `${ep.season}-${ep.episode}`
      const prev = epMap.get(k)
      if (!prev || ep.file.bytes > prev.file.bytes) epMap.set(k, ep)
    }
    const episodes = [...epMap.values()].sort((a, b) =>
      a.season - b.season || a.episode - b.episode,
    )
    tvOut.push({
      tmdbId,
      imdbId: slot.show.external_ids?.imdb_id ?? null,
      title: slot.show.name,
      posterPath: slot.show.poster_path,
      episodes,
      addedAt: slot.addedAt,
    })
  }

  // newest first
  const movies = [...dedupedMovies.values()].sort((a, b) => b.addedAt - a.addedAt)
  tvOut.sort((a, b) => b.addedAt - a.addedAt)

  return {
    movies,
    tv: tvOut,
    unmatched,
    syncedAt: Date.now(),
    stats: {
      torrents: torrents.length,
      files: items.length,
      matched: movies.length + tvOut.reduce((n, s) => n + s.episodes.length, 0),
    },
  }
})
