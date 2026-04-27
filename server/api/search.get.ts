export default defineEventHandler(async (event) => {
  const { q, page = '1' } = getQuery(event)

  if (!q) {
    throw createError({ statusCode: 400, message: 'Missing query parameter: q' })
  }

  const apiKey = process.env.TMDB_API_KEY
  return await $fetch(`https://api.themoviedb.org/3/search/multi`, {
    params: { api_key: apiKey, query: q, page, include_adult: 'false' },
  })
})
