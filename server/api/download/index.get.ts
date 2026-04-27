import { spawn } from 'node:child_process'
import { unrestrictLink } from '~/server/utils/rd'
import { dlTokens } from '~/server/utils/dlTokens'

/**
 * Stream the requested RD file through ffmpeg, remuxing to MP4 with AAC audio
 * (subs dropped). Pipes ffmpeg stdout straight to the HTTP response so no
 * temp file ever hits disk. Locked to local: Vercel can't run ffmpeg long
 * enough to remux a movie.
 */
export default defineEventHandler(async (event) => {
  if (process.env.VERCEL) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Download not available on Vercel',
      data: { reason: 'vercel' },
    })
  }

  const { token } = getQuery(event) as { token?: string }
  if (!token) {
    throw createError({ statusCode: 400, message: 'Missing token' })
  }

  const entry = dlTokens.take(token)
  if (!entry) {
    throw createError({ statusCode: 401, message: 'Invalid or expired token' })
  }

  // Resolve the RD hoster link to a fresh direct URL.
  let directUrl: string
  try {
    const data = await unrestrictLink(entry.link)
    directUrl = data.download
  } catch (err: any) {
    throw createError({ statusCode: 502, message: `RD unrestrict failed: ${err.message}` })
  }

  // Build the output filename: same base, .mp4 extension.
  const base = entry.filename.replace(/\.[a-z0-9]{2,4}$/i, '')
  const outName = `${base}.mp4`

  // ffmpeg args: copy video, transcode audio to AAC stereo, drop subs,
  // emit a fragmented MP4 that streams cleanly to a download.
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', directUrl,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-sn',
    '-movflags', '+empty_moov+frag_keyframe+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ]

  const res = event.node.res
  const req = event.node.req

  res.setHeader('Content-Type', 'video/mp4')
  // Approximate length so iOS can show a progress bar. The remux output won't
  // be exactly this size — copy-mode video keeps the same bytes, AAC re-encode
  // is usually within a few MB. Sending the original size as a hint.
  if (entry.bytes > 0) res.setHeader('Content-Length', String(entry.bytes))
  res.setHeader('Content-Disposition', `attachment; filename="${outName.replace(/"/g, '')}"`)
  res.setHeader('Cache-Control', 'no-store')

  let ffmpeg
  try {
    ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err: any) {
    throw createError({ statusCode: 500, message: `Failed to spawn ffmpeg: ${err.message}` })
  }

  let spawnError: string | null = null
  ffmpeg.on('error', (err: any) => {
    spawnError = err.code === 'ENOENT'
      ? 'ffmpeg not found — install it with `brew install ffmpeg`'
      : `ffmpeg error: ${err.message}`
    if (!res.headersSent) {
      res.statusCode = 500
      res.end(spawnError)
    } else {
      res.end()
    }
  })

  // Surface stderr to server logs so failures are debuggable.
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    // Only log unexpected output; -loglevel error already suppresses noise.
    if (text.trim()) console.error('[ffmpeg]', text.trim())
  })

  // If the client disconnects (closes tab, cancels download), kill ffmpeg.
  req.on('close', () => {
    if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL')
  })

  ffmpeg.stdout.pipe(res)

  ffmpeg.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      console.error(`[ffmpeg] exited with code ${code}`)
      res.end()
    }
  })

  // Don't return — Nuxt would try to send another response. Mark handled.
  return new Promise(() => {})
})
