export default defineEventHandler(async (event) => {
  const { type = 'all', page = '1' } = getQuery(event)

  if (!['movie', 'tv', 'all'].includes(type as string)) {
    throw createError({ statusCode: 400, message: 'Invalid type. Must be movie, tv, or all' })
  }

  const apiKey = process.env.TMDB_API_KEY
  return await $fetch(`https://api.themoviedb.org/3/trending/${type}/week`, {
    params: { api_key: apiKey, page },
  })
})
