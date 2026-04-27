export default defineEventHandler(async (event) => {
  const { id, season } = getQuery(event)

  if (!id || season === undefined) {
    throw createError({ statusCode: 400, message: 'Missing parameters: id, season' })
  }

  const apiKey = process.env.TMDB_API_KEY
  return await $fetch(`https://api.themoviedb.org/3/tv/${id}/season/${season}`, {
    params: { api_key: apiKey },
  })
})
