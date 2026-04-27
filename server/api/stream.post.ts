import { unrestrictLink } from '~/server/utils/rd'

/**
 * Resolve an RD hoster link to a fresh streamable URL.
 * The result expires within hours, so we re-resolve on every play.
 */
export default defineEventHandler(async (event) => {
  const secret = getHeader(event, 'x-app-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const body = await readBody(event)
  const { link } = body || {}
  if (!link) {
    throw createError({ statusCode: 400, message: 'Missing required field: link' })
  }

  try {
    const data = await unrestrictLink(link)
    return {
      success: true,
      url: data.download,
      filename: data.filename,
      filesize: data.filesize,
      mimeType: data.mimeType,
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unrestrict failed' }
  }
})
