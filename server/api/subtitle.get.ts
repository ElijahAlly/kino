/**
 * Fetch a subtitle file and return it as WebVTT for the browser <track> element.
 *
 * Why a server proxy:
 *   - Most subtitle hosts don't send permissive CORS headers, so the browser
 *     refuses to load them as a <track> src directly.
 *   - SRT and ASS aren't supported natively by HTMLMediaElement — we have to
 *     convert to WebVTT.
 *   - Some files are gzipped or use legacy encodings (Windows-1252,
 *     ISO-8859-1, etc.). We sniff and decode here.
 *
 * Takes the base64-encoded URL produced by /api/subtitles to keep the
 * query-string clean and avoid double-encoding mistakes.
 */

interface Query {
  u?: string         // base64-encoded subtitle URL
  format?: string    // hint: 'srt' | 'vtt' | 'ass' | 'ssa'
}

function decodeUrl(b64: string): string | null {
  try {
    const url = Buffer.from(b64, 'base64').toString('utf-8')
    // Only allow http(s) — defensive against accidental file:// or javascript: URIs.
    if (!/^https?:\/\//i.test(url)) return null
    return url
  } catch {
    return null
  }
}

function detectEncodingFromBom(buf: Uint8Array): string | null {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8'
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le'
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be'
  return null
}

function decodeBytes(buf: Uint8Array): string {
  const bom = detectEncodingFromBom(buf)
  if (bom) {
    try { return new TextDecoder(bom).decode(buf) } catch {}
  }
  // Try UTF-8 first; if it produces replacement chars, fall back to Windows-1252
  // which is a common encoding for non-English subtitle files.
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (!/�/.test(utf8)) return utf8
  } catch {}
  try {
    return new TextDecoder('windows-1252').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

function inferFormatFromUrl(url: string, hint?: string): 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown' {
  const h = (hint || '').toLowerCase()
  if (h === 'srt' || h === 'vtt' || h === 'ass' || h === 'ssa') return h
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (path.endsWith('.vtt')) return 'vtt'
    if (path.endsWith('.srt')) return 'srt'
    if (path.endsWith('.ass')) return 'ass'
    if (path.endsWith('.ssa')) return 'ssa'
  } catch {}
  return 'unknown'
}

function inferFormatFromContent(text: string): 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown' {
  const head = text.slice(0, 500)
  if (/^﻿?WEBVTT/i.test(head)) return 'vtt'
  if (/\[Script Info\]/i.test(head) && /\[V4(\+)? Styles\]/i.test(text)) {
    return /\[V4\+ Styles\]/i.test(text) ? 'ass' : 'ssa'
  }
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/m.test(head)) {
    return 'srt'
  }
  return 'unknown'
}

// SRT → WebVTT: WEBVTT header, comma → period in timestamps, normalize newlines.
function srtToVtt(srt: string): string {
  let s = srt.replace(/\r\n?/g, '\n').replace(/^﻿/, '').trim()
  // Strip cue numbers — VTT allows them but they confuse some parsers when
  // the file mixes numeric IDs with named ones.
  s = s.replace(/^\d+\s*\n(?=\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->)/gm, '')
  // Comma decimals → period decimals (SRT uses "," WebVTT uses ".")
  s = s.replace(
    /(\d{2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2})[,.](\d{3})/g,
    '$1.$2 --> $3.$4',
  )
  return `WEBVTT\n\n${s}\n`
}

// ASS/SSA → WebVTT: best-effort. Strips styling overrides ({\...}) and
// converts H:MM:SS.cc → HH:MM:SS.mmm. Position/animation tags are dropped.
function assToVtt(ass: string): string {
  const lines = ass.replace(/\r\n?/g, '\n').split('\n')
  const events: { start: string; end: string; text: string }[] = []
  let format: string[] | null = null

  for (const line of lines) {
    if (/^\s*Format\s*:/i.test(line) && format == null) {
      format = line.replace(/^\s*Format\s*:/i, '').split(',').map(s => s.trim().toLowerCase())
      continue
    }
    if (!/^\s*Dialogue\s*:/i.test(line)) continue
    const body = line.replace(/^\s*Dialogue\s*:/i, '')
    if (!format) continue

    // Dialogue field count = format count - 1, last field is the text and may
    // contain commas. Re-join after the (format.length - 1)-th comma.
    const parts = body.split(',')
    const head = parts.slice(0, format.length - 1).map(s => s.trim())
    const text = parts.slice(format.length - 1).join(',').trim()

    const idx: Record<string, number> = {}
    format.forEach((f, i) => { idx[f] = i })
    const start = head[idx.start]
    const end = head[idx.end]
    if (!start || !end) continue

    const cleaned = text
      .replace(/\{\\[^}]*\}/g, '')   // strip override blocks
      .replace(/\\N/g, '\n')         // ASS hard newline
      .replace(/\\h/g, ' ')          // ASS non-breaking space
      .replace(/\\n/g, ' ')          // ASS soft newline → space
      .trim()
    if (!cleaned) continue

    events.push({ start: assTimeToVtt(start), end: assTimeToVtt(end), text: cleaned })
  }

  const cues = events.map((e, i) => `${i + 1}\n${e.start} --> ${e.end}\n${e.text}`).join('\n\n')
  return `WEBVTT\n\n${cues}\n`
}

function assTimeToVtt(t: string): string {
  // ASS: H:MM:SS.cc (cc = centiseconds). Pad and convert to HH:MM:SS.mmm.
  const m = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(t.trim())
  if (!m) return '00:00:00.000'
  const h = m[1].padStart(2, '0')
  const cc = m[4].padEnd(3, '0').slice(0, 3)
  return `${h}:${m[2]}:${m[3]}.${cc}`
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event) as Query
  if (!q.u) {
    throw createError({ statusCode: 400, message: 'Missing required param: u' })
  }
  const url = decodeUrl(q.u)
  if (!url) {
    throw createError({ statusCode: 400, message: 'Invalid subtitle URL' })
  }

  let buf: ArrayBuffer
  try {
    const res = await fetch(url, {
      // Some hosts 403 without a typical UA; keep it innocuous.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KinoSubs/1.0)' },
      redirect: 'follow',
    })
    if (!res.ok) {
      throw createError({ statusCode: 502, message: `Upstream ${res.status}` })
    }
    buf = await res.arrayBuffer()
  } catch (err: any) {
    throw createError({ statusCode: 502, message: err?.message || 'Subtitle fetch failed' })
  }

  const bytes = new Uint8Array(buf)
  const text = decodeBytes(bytes)

  const fmt = inferFormatFromUrl(url, q.format) === 'unknown'
    ? inferFormatFromContent(text)
    : inferFormatFromUrl(url, q.format)

  let vtt: string
  switch (fmt) {
    case 'vtt': vtt = text.startsWith('﻿') ? text.slice(1) : text; break
    case 'srt': vtt = srtToVtt(text); break
    case 'ass':
    case 'ssa': vtt = assToVtt(text); break
    default:
      // Last-ditch: assume SRT-shaped if it has cue arrows, else wrap as VTT.
      vtt = /-->/.test(text) ? srtToVtt(text) : `WEBVTT\n\n${text}\n`
  }

  setResponseHeader(event, 'Content-Type', 'text/vtt; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600')
  return vtt
})
