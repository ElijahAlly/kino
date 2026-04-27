/**
 * Real-Debrid REST helpers. All calls use the RD_TOKEN env var.
 *
 * Endpoints used:
 *   GET  /torrents             list user's torrents
 *   GET  /torrents/info/{id}   files inside a single torrent
 *   POST /unrestrict/link      hoster link → direct streamable URL
 */

const RD_BASE = 'https://api.real-debrid.com/rest/1.0'

export interface RdTorrent {
  id: string
  filename: string
  original_filename?: string
  hash: string
  bytes: number
  host: string
  progress: number
  status: string
  added: string
  links: string[]
  ended?: string
}

export interface RdTorrentFile {
  id: number
  path: string
  bytes: number
  selected: 0 | 1
}

export interface RdTorrentInfo extends RdTorrent {
  files: RdTorrentFile[]
}

function rdToken(): string {
  const t = process.env.RD_TOKEN
  if (!t) throw new Error('RD_TOKEN not configured')
  return t
}

async function rdFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RD_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${rdToken()}`,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`RD ${path} ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/**
 * RD's /torrents strips the `links` field when limit is high. Page through with
 * the default limit (100 per page) to keep links populated.
 */
export async function listTorrents(maxPages = 25): Promise<RdTorrent[]> {
  const all: RdTorrent[] = []
  for (let page = 1; page <= maxPages; page++) {
    const batch = await rdFetch<RdTorrent[]>(`/torrents?page=${page}&limit=100`)
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

export async function getTorrentInfo(id: string): Promise<RdTorrentInfo> {
  return rdFetch<RdTorrentInfo>(`/torrents/info/${id}`)
}

export async function unrestrictLink(link: string): Promise<{ download: string; filename: string; filesize: number; mimeType?: string }> {
  const form = new URLSearchParams({ link })
  return rdFetch('/unrestrict/link', {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}
