export default defineEventHandler(async (event) => {
  const { id, type } = getQuery(event)

  if (!id || !type) {
    throw createError({ statusCode: 400, message: 'Missing parameters: id, type' })
  }

  if (!['movie', 'tv'].includes(type as string)) {
    throw createError({ statusCode: 400, message: 'Invalid type. Must be movie or tv' })
  }

  const apiKey = process.env.TMDB_API_KEY
  return await $fetch(`https://api.themoviedb.org/3/${type}/${id}`, {
    params: { api_key: apiKey, append_to_response: 'videos,credits,external_ids,similar' },
  })
})
