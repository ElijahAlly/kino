interface DiscoverConfig {
  url: string
  params?: Record<string, string | number>
}

const today = () => new Date().toISOString().split('T')[0]
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

// TMDB watch provider IDs (https://api.themoviedb.org/3/watch/providers/movie?api_key=...)
const PROVIDERS: Record<string, number> = {
  netflix: 8,
  prime: 9,
  hulu: 15,
  disney: 337,
  apple: 350,
  max: 1899,
  paramount: 531,
  peacock: 386,
}

function buildConfig(category: string): DiscoverConfig | null {
  switch (category) {
    case 'popular-movies':
      return { url: 'https://api.themoviedb.org/3/movie/popular' }
    case 'popular-tv':
      return { url: 'https://api.themoviedb.org/3/tv/popular' }
    case 'just-released':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: {
          'primary_release_date.gte': daysAgo(45),
          'primary_release_date.lte': today(),
          sort_by: 'popularity.desc',
        },
      }
    case 'action':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: { with_genres: '28', sort_by: 'popularity.desc' },
      }
    case 'comedy':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: { with_genres: '35', sort_by: 'popularity.desc' },
      }
    case 'anime':
      return {
        url: 'https://api.themoviedb.org/3/discover/tv',
        params: {
          with_genres: '16',
          with_origin_country: 'JP',
          sort_by: 'popularity.desc',
        },
      }
    case 'black-films':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: { with_keywords: '11055', sort_by: 'popularity.desc' },
      }
    case 'a24':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: { with_companies: '41077', sort_by: 'popularity.desc' },
      }
    case 'blockbusters':
      return {
        url: 'https://api.themoviedb.org/3/discover/movie',
        params: {
          sort_by: 'revenue.desc',
          'primary_release_date.gte': '2018-01-01',
          'vote_count.gte': '500',
        },
      }
    case 'top-rated':
      return { url: 'https://api.themoviedb.org/3/movie/top_rated' }
    default:
      return null
  }
}

async function fetchPlatform(providerId: number, region: string, page: string | number, apiKey: string) {
  const baseParams = {
    api_key: apiKey,
    page,
    sort_by: 'popularity.desc',
    watch_region: region,
    with_watch_providers: providerId,
    with_watch_monetization_types: 'flatrate',
  }

  const [movieRes, tvRes] = await Promise.allSettled([
    $fetch<any>('https://api.themoviedb.org/3/discover/movie', { params: baseParams }),
    $fetch<any>('https://api.themoviedb.org/3/discover/tv', { params: baseParams }),
  ])

  const movies = movieRes.status === 'fulfilled' ? movieRes.value.results || [] : []
  const tv = tvRes.status === 'fulfilled' ? tvRes.value.results || [] : []

  const combined = [
    ...movies.map((r: any) => ({ ...r, media_type: 'movie' })),
    ...tv.map((r: any) => ({ ...r, media_type: 'tv' })),
  ]
  combined.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))

  return { page, results: combined.slice(0, 40), total_pages: 1 }
}

export default defineEventHandler(async (event) => {
  const { category, page = '1', region = 'US' } = getQuery(event)

  if (!category) {
    throw createError({ statusCode: 400, message: 'Missing category' })
  }

  const apiKey = process.env.TMDB_API_KEY!
  const cat = category as string

  // Streaming platform categories: combine movies + TV from that provider
  if (cat.startsWith('platform-')) {
    const key = cat.slice('platform-'.length)
    const providerId = PROVIDERS[key]
    if (!providerId) {
      throw createError({ statusCode: 400, message: `Unknown platform: ${key}` })
    }
    return await fetchPlatform(providerId, region as string, page as string, apiKey)
  }

  const config = buildConfig(cat)
  if (!config) {
    throw createError({ statusCode: 400, message: `Unknown category: ${cat}` })
  }

  return await $fetch(config.url, {
    params: { api_key: apiKey, page, ...config.params },
  })
})
