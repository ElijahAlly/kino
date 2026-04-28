/**
 * Delete a Real-Debrid torrent. The library re-syncs after a successful
 * delete, dropping the title from the user's view. We accept a list of
 * torrentIds because deleting a TV show should remove every season-pack
 * torrent that contributed to it; the client computes the set.
 */

const RD_BASE = 'https://api.real-debrid.com/rest/1.0'

export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const rdToken = process.env.RD_TOKEN
  if (!rdToken) {
    throw createError({ statusCode: 500, message: 'RD_TOKEN not configured' })
  }

  const body = await readBody(event)
  const torrentIds: string[] = Array.isArray(body?.torrentIds)
    ? body.torrentIds.filter((x: any) => typeof x === 'string')
    : []
  if (!torrentIds.length) {
    throw createError({ statusCode: 400, message: 'Missing torrentIds (string[])' })
  }

  const removed: string[] = []
  const failed: { id: string; error: string }[] = []

  for (const id of torrentIds) {
    try {
      const res = await fetch(`${RD_BASE}/torrents/delete/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${rdToken}` },
      })
      // RD returns 204 on success. 404 means already gone — treat as success.
      if (res.ok || res.status === 404) {
        removed.push(id)
      } else {
        const text = await res.text().catch(() => '')
        failed.push({ id, error: `HTTP ${res.status}: ${text.slice(0, 120)}` })
      }
    } catch (err: any) {
      failed.push({ id, error: err.message || 'request failed' })
    }
  }

  return { success: failed.length === 0, removed, failed }
})
