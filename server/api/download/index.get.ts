import { spawn, spawnSync } from 'node:child_process'
import { Transform } from 'node:stream'
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

  // Probe the source video codec. iOS / AVPlayer only plays HEVC in MP4 when
  // the codec tag is `hvc1`; ffmpeg's `-c:v copy` preserves whatever the source
  // had (usually `hev1`), which renders as an unplayable file in iOS Files.
  // We need to know the codec up front so we can set `-tag:v hvc1` for HEVC
  // without breaking H.264 sources (which require `avc1`).
  let videoCodec = ''
  try {
    const probe = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=nw=1:nk=1',
      directUrl,
    ], { encoding: 'utf8', timeout: 30_000 })
    videoCodec = (probe.stdout || '').trim().toLowerCase()
  } catch {
    // ffprobe missing or failed — fall through with empty codec; the copy will
    // still produce a file, just without the iOS-compatible tag.
  }

  // ffmpeg args: copy video, transcode audio to AAC stereo, drop subs,
  // emit a fragmented MP4 that streams cleanly to a download. The reconnect
  // flags keep the HTTP input alive across transient RD/network drops, which
  // are the usual cause of long downloads failing partway through.
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-stats',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-reconnect_delay_max', '30',
    '-rw_timeout', '30000000',
    '-y',
    '-i', directUrl,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    ...(videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
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
  // Don't set Content-Length: ffmpeg drops subtitle tracks and re-encodes audio
  // to AAC, so the output is typically smaller than the source. Declaring the
  // source size made browsers flag completed downloads as failed when the
  // stream ended short of the promised length. Without it, transfer falls back
  // to chunked encoding — iOS shows "Downloading…" instead of a percentage,
  // but the download actually completes.
  res.setHeader('Content-Disposition', `attachment; filename="${outName.replace(/"/g, '')}"`)
  res.setHeader('Cache-Control', 'no-store')

  let ffmpeg
  try {
    ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err: any) {
    throw createError({ statusCode: 500, message: `Failed to spawn ffmpeg: ${err.message}` })
  }

  const startedAt = Date.now()
  const expectedBytes = entry.bytes || 0
  let transferred = 0
  let lastTickMs = 0
  let lastLoggedPct = -1

  console.log(`[download] start "${outName}" expected≈${fmtBytes(expectedBytes)} pid=${ffmpeg.pid}`)

  // Tee bytes flowing from ffmpeg → response so we can render a progress bar
  // and accurate completion logs. The transform passes data through unchanged.
  const counter = new Transform({
    transform(chunk: any, _enc: any, cb: any) {
      transferred += chunk.length
      const now = Date.now()
      // Throttle to ~4 updates/sec to keep the terminal readable.
      if (now - lastTickMs >= 250) {
        lastTickMs = now
        renderProgress(transferred, expectedBytes, startedAt)
      }
      // Also drop a permanent log line every 10% so logs stay grep-able even
      // after the live bar gets overwritten.
      if (expectedBytes > 0) {
        const pct = Math.floor((transferred / expectedBytes) * 10) * 10
        if (pct >= 10 && pct !== lastLoggedPct) {
          lastLoggedPct = pct
          process.stdout.write('\n')
          console.log(`[download] ${pct}% — ${fmtBytes(transferred)} / ${fmtBytes(expectedBytes)} in ${fmtDuration((now - startedAt) / 1000)}`)
        }
      }
      cb(null, chunk)
    },
  })

  let spawnError: string | null = null
  ffmpeg.on('error', (err: any) => {
    spawnError = err.code === 'ENOENT'
      ? 'ffmpeg not found — install it with `brew install ffmpeg`'
      : `ffmpeg error: ${err.message}`
    process.stdout.write('\n')
    console.error(`[download] ${spawnError}`)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end(spawnError)
    } else {
      res.end()
    }
  })

  // Surface stderr to server logs so failures are debuggable. ffmpeg writes
  // -stats progress lines (frame=/size=) to stderr too — those aren't errors,
  // and we already render a progress bar from byte counts, so drop them.
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (!text) return
    const lines = text.split(/\r?\n/).filter((l: string) => l && !/^(frame|size)=/.test(l.trim()))
    if (!lines.length) return
    process.stdout.write('\n')
    console.log('[ffmpeg]', lines.join(' | '))
  })

  let clientClosed = false
  // If the client disconnects (closes tab, cancels download), kill ffmpeg.
  req.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true
      process.stdout.write('\n')
      console.warn(`[download] client disconnected at ${fmtBytes(transferred)} / ${fmtBytes(expectedBytes)} (${pctStr(transferred, expectedBytes)})`)
      if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL')
    }
  })

  ffmpeg.stdout.pipe(counter).pipe(res)

  ffmpeg.on('close', (code: any, signal: any) => {
    process.stdout.write('\n')
    const elapsedSec = (Date.now() - startedAt) / 1000
    if (code === 0) {
      console.log(`[download] done "${outName}" — ${fmtBytes(transferred)} in ${fmtDuration(elapsedSec)}`)
    } else if (clientClosed) {
      console.warn(`[download] aborted "${outName}" — ${fmtBytes(transferred)} / ${fmtBytes(expectedBytes)} after ${fmtDuration(elapsedSec)}`)
    } else {
      console.error(
        `[download] failed "${outName}" — ffmpeg exited code=${code}${signal ? ` signal=${signal}` : ''} ` +
        `at ${fmtBytes(transferred)} / ${fmtBytes(expectedBytes)} (${pctStr(transferred, expectedBytes)}) after ${fmtDuration(elapsedSec)}`,
      )
      if (!res.writableEnded) res.end()
    }
  })

  // Don't return — Nuxt would try to send another response. Mark handled.
  return new Promise(() => {})
})

function fmtBytes(b: number): string {
  if (!b) return '0 B'
  const gb = b / 1_000_000_000
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(b / 1_000_000).toFixed(0)} MB`
}

function pctStr(done: number, total: number): string {
  if (!total) return '?%'
  return `${((done / total) * 100).toFixed(1)}%`
}

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const BAR_WIDTH = 24

function renderProgress(done: number, total: number, startMs: number) {
  const elapsedMs = Date.now() - startMs
  const rate = elapsedMs > 0 ? done / (elapsedMs / 1000) : 0
  const rateMb = rate / 1_000_000
  let bar: string
  let pctText: string
  let etaText: string
  if (total > 0) {
    const pct = Math.min(100, (done / total) * 100)
    pctText = `${pct.toFixed(1).padStart(5)}%`
    const filled = Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH))
    bar = '[' + '='.repeat(filled) + (filled < BAR_WIDTH ? '>' : '') + ' '.repeat(Math.max(0, BAR_WIDTH - filled - 1)) + ']'
    etaText = rate > 0 ? fmtDuration((total - done) / rate) : '?'
  } else {
    pctText = '   ?%'
    bar = '[' + ' '.repeat(BAR_WIDTH) + ']'
    etaText = '?'
  }
  const line = `[download] ${bar} ${pctText}  ${fmtBytes(done).padStart(8)} / ${fmtBytes(total).padStart(8)}  ${rateMb.toFixed(1).padStart(5)} MB/s  ETA ${etaText}`
  // Clear the rest of the previous line, then carriage return so subsequent
  // updates overwrite in place. Falls back gracefully when stdout isn't a TTY.
  if (process.stdout.isTTY) {
    process.stdout.write('\r' + line + '\x1b[K')
  } else {
    // Non-TTY (e.g. piped to a logfile): print once per ~10% via the milestone
    // logger above; skip the noisy live updates here.
  }
}
