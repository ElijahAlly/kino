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
  const { imdbId, season, episode } = body || {}

  if (!imdbId) {
    throw createError({ statusCode: 400, message: 'Missing required field: imdbId' })
  }

  const rdToken = process.env.RD_TOKEN
  if (!rdToken) {
    return { success: false, error: 'Server missing RD_TOKEN env var' }
  }

  const config = `qualityfilter=unknown,threed,cam,scr,brremux,hdrall,other,480p,4k|realdebrid=${rdToken}`
  const base = `https://torrentio.strem.fun/${config}`

  const streamUrl = season !== undefined && episode !== undefined
    ? `${base}/stream/series/${imdbId}:${season}:${episode}.json`
    : `${base}/stream/movie/${imdbId}.json`

  // Native fetch + manual JSON parse — matches what curl in watch.sh does.
  // Avoids ofetch URL normalization (which can encode `|` to `%7C`).
  let streams: any[] = []
  let rawSnippet = ''
  try {
    const res = await fetch(streamUrl)
    if (!res.ok) {
      return { success: false, error: `Torrentio HTTP ${res.status}` }
    }
    const text = await res.text()
    rawSnippet = text.slice(0, 200)
    const data = JSON.parse(text)
    streams = Array.isArray(data?.streams) ? data.streams : []
  } catch (err: any) {
    return { success: false, error: `Torrentio request failed: ${err.message}`, rawSnippet }
  }

  if (streams.length === 0) {
    return {
      success: false,
      error: 'Torrentio returned 0 streams (movie may not be cached on RD or all qualities filtered)',
      rawSnippet,
    }
  }

  const attempts: string[] = []
  const maxTries = Math.min(streams.length, 5)
  for (let i = 0; i < maxTries; i++) {
    const stream = streams[i]
    if (!stream.url) continue
    try {
      const finalUrl = await followRedirects(stream.url)
      const isRD = finalUrl.includes('real-debrid.com')
      attempts.push(`${(stream.title || '?').slice(0, 50)} → ${isRD ? 'RD ✓' : 'not cached'}`)
      if (isRD) {
        return { success: true, title: stream.title || '', url: finalUrl }
      }
    } catch (err: any) {
      attempts.push(`hop error: ${err.message}`)
    }
  }

  return {
    success: false,
    error: `${streams.length} streams found, none cached on RD`,
    attempts,
  }
})
