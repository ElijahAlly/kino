async function followRedirects(url: string, maxHops = 10): Promise<string> {
  let currentUrl = url
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(currentUrl, { redirect: 'manual' })
    const location = res.headers.get('location')
    if (!location) return currentUrl
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href
  }
  return currentUrl
}

export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { imdbId, season, episode } = body

  if (!imdbId) {
    throw createError({ statusCode: 400, message: 'Missing required field: imdbId' })
  }

  const rdToken = process.env.RD_TOKEN
  const config = `qualityfilter=unknown,threed,cam,scr,brremux,hdrall,other,480p,4k|realdebrid=${rdToken}`
  const base = `https://torrentio.strem.fun/${config}`

  const streamUrl = season !== undefined && episode !== undefined
    ? `${base}/stream/series/${imdbId}:${season}:${episode}.json`
    : `${base}/stream/movie/${imdbId}.json`

  const torrentioData: any = await $fetch(streamUrl)
  const streams = torrentioData.streams

  if (!streams || streams.length === 0) {
    return { success: false, error: 'No streams found' }
  }

  const maxTries = Math.min(streams.length, 5)
  for (let i = 0; i < maxTries; i++) {
    const stream = streams[i]
    if (!stream.url) continue
    try {
      const finalUrl = await followRedirects(stream.url)
      if (finalUrl.includes('real-debrid.com')) {
        return { success: true, title: stream.title || '', url: finalUrl }
      }
    } catch {
      continue
    }
  }

  return { success: false, error: 'No cached streams available' }
})
