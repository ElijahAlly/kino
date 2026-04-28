import { dlTokens, randomToken } from '~/server/utils/dlTokens'

/**
 * Mints a one-time token the browser can use to start a download via GET.
 *
 * Blocked on Vercel because ffmpeg can't run in serverless. The client should
 * detect the 503 and tell the user to switch to their MacBook's Tailscale URL.
 */
export default defineEventHandler(async (event) => {
  if (process.env.VERCEL) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Download not available on Vercel',
      data: {
        reason: 'vercel',
        message: 'Downloads need ffmpeg on your local MacBook. Open kino through your Tailscale URL and try again.',
      },
    })
  }

  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { link, directUrl, filename, bytes } = body || {}
  if (!filename || (!link && !directUrl)) {
    throw createError({ statusCode: 400, message: 'Missing filename or link/directUrl' })
  }

  const token = randomToken()
  dlTokens.put(token, {
    link: link ? String(link) : undefined,
    directUrl: directUrl ? String(directUrl) : undefined,
    filename: String(filename),
    bytes: Number(bytes) || 0,
  })

  return { token }
})
