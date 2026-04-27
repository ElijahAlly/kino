/**
 * Search TMDB for fix-match. Returns top results across movies + TV.
 */
export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { q, type } = getQuery(event) as { q?: string; type?: 'movie' | 'tv' | 'multi' }
  if (!q) {
    throw createError({ statusCode: 400, message: 'Missing query parameter: q' })
  }

  const apiKey = process.env.TMDB_API_KEY
  const endpoint = type === 'movie' || type === 'tv' ? `search/${type}` : 'search/multi'
  const data: any = await $fetch(`https://api.themoviedb.org/3/${endpoint}`, {
    params: { api_key: apiKey, query: q, include_adult: 'false' },
  })

  const results = (data.results || [])
    .filter((r: any) => {
      if (type === 'movie') return true
      if (type === 'tv') return true
      return r.media_type === 'movie' || r.media_type === 'tv'
    })
    .slice(0, 10)
    .map((r: any) => ({
      id: r.id,
      type: type === 'movie' ? 'movie' : type === 'tv' ? 'tv' : r.media_type,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      posterPath: r.poster_path,
      overview: r.overview,
    }))

  return { results }
})
