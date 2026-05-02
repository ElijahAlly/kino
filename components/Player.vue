<script setup lang="ts">
import type { LibraryEpisode } from '~/composables/useLibrary'

interface Props {
  // Identity for resume tracking
  tmdbId: number
  season?: number
  episode?: number

  // Display
  title: string
  subtitle?: string

  // Source — at least one of these must be set:
  //   link      RD hoster link; we POST /api/stream to unrestrict it on play.
  //             Used by the library-driven /play/movie/:id route.
  //   directUrl Already-unrestricted RD download URL. Used when the caller
  //             came from /api/watch (search/browse → Watch button) and we
  //             want to skip a redundant unrestrict round-trip.
  link?: string
  directUrl?: string
  bytes: number
  filename: string

  // TV neighbors (already filtered to library presence)
  prevEpisode?: LibraryEpisode | null
  nextEpisode?: LibraryEpisode | null

  // For TV navigation
  showTmdbId?: number

  // IMDb ID — used to look up external subtitles. Optional; when missing the
  // CC button is hidden and we just play without subtitles.
  imdbId?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ goto: [season: number, episode: number] }>()

const router = useRouter()
const { ensureAuth, clearAuth } = useAuth()
const { showToast } = useToast()
const resume = useResume()

const videoEl = ref<HTMLVideoElement | null>(null)
const containerEl = ref<HTMLDivElement | null>(null)

const streamUrl = ref<string | null>(null)
const loadingStream = ref(true)
const streamError = ref<string | null>(null)

const playing = ref(false)
const muted = ref(false)
const volume = ref(1)
const currentTime = ref(0)
const duration = ref(0)
const buffered = ref(0)
const isFullscreen = ref(false)
const showControls = ref(true)
const showDownloadModal = ref(false)

let hideTimer: number | null = null
let saveTimer: number | null = null

// ------- subtitles -------

interface SubtitleTrack {
  id: string
  language: string
  label: string
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown'
  hearingImpaired: boolean
  source: string
  url: string  // base64-encoded original URL — fed back to /api/subtitle
}

const SUB_PREFS_KEY = 'kino-subtitle-prefs-v1'

interface SubtitlePrefs {
  enabled: boolean
  preferredLang: string | null    // ISO code, e.g. 'en'
  fontFamily: string
  fontScale: number               // 0.6 .. 2.4 (multiplier on base 22px)
  textColor: string
  textOpacity: number             // 0..1
  bgColor: string
  bgOpacity: number               // 0..1
  edgeStyle: 'none' | 'shadow' | 'outline' | 'raised' | 'depressed'
  position: number                // 0 (top) .. 100 (bottom-most)
}

const DEFAULT_PREFS: SubtitlePrefs = {
  enabled: true,
  preferredLang: 'en',
  fontFamily: 'system',
  fontScale: 1,
  textColor: '#ffffff',
  textOpacity: 1,
  bgColor: '#000000',
  bgOpacity: 0.6,
  edgeStyle: 'shadow',
  position: 88,
}

function loadPrefs(): SubtitlePrefs {
  try {
    const raw = localStorage.getItem(SUB_PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function savePrefs(p: SubtitlePrefs) {
  try { localStorage.setItem(SUB_PREFS_KEY, JSON.stringify(p)) } catch {}
}

const subtitleTracks = ref<SubtitleTrack[]>([])
const loadingSubtitles = ref(false)
const activeTrackId = ref<string | null>(null)
const showCcMenu = ref(false)
const showCcCustomize = ref(false)
const prefs = ref<SubtitlePrefs>({ ...DEFAULT_PREFS })

const subtitlesAvailable = computed(() => !!props.imdbId)

const FONT_FAMILIES: { value: string; label: string; css: string }[] = [
  { value: 'system', label: 'Default', css: 'system-ui, -apple-system, sans-serif' },
  { value: 'sans', label: 'Sans-serif', css: '"Helvetica Neue", Arial, sans-serif' },
  { value: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { value: 'mono', label: 'Monospace', css: '"SF Mono", Menlo, Consolas, monospace' },
  { value: 'rounded', label: 'Rounded', css: '"SF Pro Rounded", "Nunito", system-ui, sans-serif' },
]

function fontFamilyCss(value: string): string {
  return FONT_FAMILIES.find(f => f.value === value)?.css || FONT_FAMILIES[0].css
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return `rgba(255,255,255,${alpha})`
  const v = parseInt(m[1], 16)
  const r = (v >> 16) & 0xff
  const g = (v >> 8) & 0xff
  const b = v & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

function edgeShadow(style: SubtitlePrefs['edgeStyle'], color: string): string {
  // Browsers (Chromium especially) ignore most ::cue properties at higher
  // specificity, but text-shadow on ::cue is broadly respected.
  switch (style) {
    case 'none': return 'none'
    case 'outline':
      return `-1px -1px 0 ${color}, 1px -1px 0 ${color}, -1px 1px 0 ${color}, 1px 1px 0 ${color}, 0 0 4px ${color}`
    case 'raised':
      return `1px 1px 0 ${color}, 2px 2px 0 ${color}, 3px 3px 4px rgba(0,0,0,0.6)`
    case 'depressed':
      return `-1px -1px 0 ${color}, 0 0 4px ${color}`
    case 'shadow':
    default:
      return `0 2px 4px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.9)`
  }
}

const cueStyle = computed(() => {
  const p = prefs.value
  return {
    fontFamily: fontFamilyCss(p.fontFamily),
    fontSize: `clamp(14px, ${(2.4 * p.fontScale).toFixed(2)}vw, ${Math.round(48 * p.fontScale)}px)`,
    color: hexToRgba(p.textColor, p.textOpacity),
    background: p.bgOpacity > 0 ? hexToRgba(p.bgColor, p.bgOpacity) : 'transparent',
    textShadow: edgeShadow(p.edgeStyle, '#000000'),
  }
})

// Position the overlay container as a percentage from the top of the video.
// 88 ≈ standard captions zone (above the bottom controls); 50 = vertical center.
const cueContainerStyle = computed(() => ({
  top: `${prefs.value.position}%`,
  transform: 'translate(-50%, -100%)',
}))

async function fetchSubtitles() {
  if (!props.imdbId) {
    subtitleTracks.value = []
    return
  }
  loadingSubtitles.value = true
  try {
    const params: Record<string, any> = { imdbId: props.imdbId }
    if (props.season != null) params.season = props.season
    if (props.episode != null) params.episode = props.episode
    const res = await $fetch<{ tracks: SubtitleTrack[]; error?: string }>('/api/subtitles', { params })
    subtitleTracks.value = res.tracks || []
  } catch {
    subtitleTracks.value = []
  } finally {
    loadingSubtitles.value = false
    pickInitialTrack()
  }
}

function pickInitialTrack() {
  if (!prefs.value.enabled || subtitleTracks.value.length === 0) {
    activeTrackId.value = null
    return
  }
  const wanted = prefs.value.preferredLang || 'en'
  const exact = subtitleTracks.value.find(t => t.language === wanted && !t.hearingImpaired)
  const langMatch = subtitleTracks.value.find(t => t.language.startsWith(wanted))
  const fallback = subtitleTracks.value[0]
  activeTrackId.value = (exact || langMatch || fallback)?.id || null
}

function selectTrack(id: string | null) {
  activeTrackId.value = id
  prefs.value.enabled = id != null
  if (id) {
    const t = subtitleTracks.value.find(x => x.id === id)
    if (t) prefs.value.preferredLang = t.language
  }
  savePrefs(prefs.value)
  showCcMenu.value = false
}

function toggleCc() {
  if (subtitleTracks.value.length === 0) return
  if (activeTrackId.value) {
    selectTrack(null)
  } else {
    pickInitialTrack()
    prefs.value.enabled = activeTrackId.value != null
    savePrefs(prefs.value)
  }
}

function updatePref<K extends keyof SubtitlePrefs>(key: K, value: SubtitlePrefs[K]) {
  prefs.value = { ...prefs.value, [key]: value }
  savePrefs(prefs.value)
}

function resetPrefs() {
  prefs.value = { ...DEFAULT_PREFS, enabled: prefs.value.enabled, preferredLang: prefs.value.preferredLang }
  savePrefs(prefs.value)
}

// Render VTT cue text into safe HTML. VTT supports <b> <i> <u> <c> tags and
// uses \n for line breaks. We escape everything else to prevent injection.
function formatCueText(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Re-allow a small whitelist of WebVTT inline tags after escaping.
  const withTags = escaped
    .replace(/&lt;(\/?(?:b|i|u))&gt;/gi, '<$1>')
    // Strip class/voice tags but keep their content.
    .replace(/&lt;c[^&]*&gt;/gi, '')
    .replace(/&lt;\/c&gt;/gi, '')
    .replace(/&lt;v[^&]*&gt;/gi, '')
    .replace(/&lt;\/v&gt;/gi, '')
  return withTags.replace(/\n/g, '<br>')
}

// Active cue text for our custom overlay. We use mode='hidden' on the chosen
// track (browser parses cues but doesn't render its own caption box), then
// listen to cuechange and paint the cues into our own DOM. This gives us full
// styling control — ::cue CSS is patchy across browsers and ignores position.
const activeCueText = ref<string[]>([])
let activeTextTrack: TextTrack | null = null

function onCueChange(this: TextTrack) {
  const list: string[] = []
  for (let i = 0; i < this.activeCues!.length; i++) {
    const cue: any = this.activeCues![i]
    if (typeof cue.text === 'string' && cue.text) list.push(cue.text)
  }
  activeCueText.value = list
}

function detachCueListener() {
  if (activeTextTrack) {
    activeTextTrack.removeEventListener('cuechange', onCueChange as EventListener)
    activeTextTrack = null
  }
  activeCueText.value = []
}

function applyTrackMode() {
  if (!videoEl.value) return
  detachCueListener()
  const tracks = videoEl.value.textTracks
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]
    const id = (t as any).id || ''
    if (id === activeTrackId.value) {
      // 'hidden' parses cues but suppresses native rendering — exactly what
      // we want so our custom overlay can show them with full styling.
      t.mode = 'hidden'
      t.addEventListener('cuechange', onCueChange as EventListener)
      activeTextTrack = t
      // Paint immediately in case cues are already loaded.
      onCueChange.call(t)
    } else {
      t.mode = 'disabled'
    }
  }
}

watch(activeTrackId, () => { nextTick(applyTrackMode) })
watch(subtitleTracks, () => { nextTick(applyTrackMode) })

// Refetch subtitles when navigating between episodes (keeps the same Player).
watch(() => [props.imdbId, props.season, props.episode], () => {
  fetchSubtitles()
})

// ------- stream resolution -------

async function resolveStream() {
  loadingStream.value = true
  streamError.value = null

  // Caller already gave us a fresh RD direct URL (Watch-from-search flow).
  // Use it as-is and skip the /api/stream round-trip.
  if (props.directUrl) {
    streamUrl.value = props.directUrl
    loadingStream.value = false
    return
  }

  if (!props.link) {
    streamError.value = 'No stream source provided.'
    loadingStream.value = false
    return
  }

  const secret = await ensureAuth()
  if (!secret) { streamError.value = 'Auth required.'; loadingStream.value = false; return }
  try {
    const res = await $fetch<{ success: boolean; url?: string; error?: string }>('/api/stream', {
      method: 'POST',
      headers: { 'X-App-Secret': secret },
      body: { link: props.link },
    })
    if (!res.success || !res.url) {
      streamError.value = res.error || 'Failed to resolve stream'
    } else {
      streamUrl.value = res.url
    }
  } catch (err: any) {
    if (err.status === 401 || err.statusCode === 401) {
      clearAuth()
      streamError.value = 'Invalid passphrase.'
    } else {
      streamError.value = err.message || 'Stream request failed'
    }
  } finally {
    loadingStream.value = false
  }
}

// ------- playback wiring -------

function onLoadedMetadata() {
  if (!videoEl.value) return
  duration.value = videoEl.value.duration || 0
  // Apply resume position if any.
  const r = resume.get(props.tmdbId, props.season, props.episode)
  if (r && r.position > 5 && (!duration.value || duration.value - r.position > 30)) {
    videoEl.value.currentTime = r.position
  }
  // Auto-play; browsers may block on no user gesture, that's fine, user clicks play.
  videoEl.value.play().catch(() => {})
}

function onTimeUpdate() {
  if (!videoEl.value) return
  currentTime.value = videoEl.value.currentTime
  // Periodic save (every 5s of playback).
  if (!saveTimer) {
    saveTimer = window.setTimeout(() => {
      if (videoEl.value) {
        resume.set(props.tmdbId, videoEl.value.currentTime, videoEl.value.duration || 0, props.season, props.episode)
      }
      saveTimer = null
    }, 5000)
  }
}

function onProgress() {
  if (!videoEl.value) return
  const ranges = videoEl.value.buffered
  if (ranges.length) buffered.value = ranges.end(ranges.length - 1)
}

function onPlay() { playing.value = true }
function onPause() {
  playing.value = false
  // Persist on pause so closing the tab doesn't lose more than a few seconds.
  if (videoEl.value) {
    resume.set(props.tmdbId, videoEl.value.currentTime, videoEl.value.duration || 0, props.season, props.episode)
  }
}
function onEnded() {
  playing.value = false
  resume.clear(props.tmdbId, props.season, props.episode)
  // Auto-advance to next episode if present.
  if (props.nextEpisode) {
    emit('goto', props.nextEpisode.season, props.nextEpisode.episode)
  }
}
function onVolumeChange() {
  if (!videoEl.value) return
  volume.value = videoEl.value.volume
  muted.value = videoEl.value.muted
}

// Catch the case where the source URL is a packed archive (.rar etc.). The
// server filters these out, but if one slips through (e.g. unrestrictLink
// returned a video URL but the redirect chain landed on an archive), we want
// to fail with a clear message instead of the generic codec error.
const ARCHIVE_EXT_RE = /\.(rar|r\d{2}|zip|7z|tar|gz|bz2|iso|cab)(?:\?|$)/i
function isArchiveUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try { return ARCHIVE_EXT_RE.test(new URL(url).pathname) } catch { return ARCHIVE_EXT_RE.test(url) }
}

function onVideoError() {
  // Triggered when the browser can't load/decode the file. Surface as much
  // diagnostic info as the element exposes — code 4 is ambiguous (it can mean
  // "unsupported codec", "wrong Content-Type", or "URL unreachable") and we
  // want to be able to tell which.
  if (!videoEl.value) return
  const v = videoEl.value
  const err = v.error
  const src = v.currentSrc || streamUrl.value || ''

  // Privacy: Firefox with `privacy.resistFingerprinting=true` blanks
  // err.message, so we can't rely on it. Detect known unplayable shapes from
  // the URL first.
  if (isArchiveUrl(src)) {
    streamError.value = 'No playable stream found — the cached file is a packed archive (.rar) the browser can\'t play. Try the Download button or pick another title.'
    console.warn('[player] archive source rejected', { src: src.slice(0, 200) })
    return
  }

  const codes: Record<number, string> = {
    1: 'Playback aborted',
    2: 'Network error while loading the file',
    3: 'Decoding error — codec not supported by this browser',
    4: 'No playable stream — the file format or codec isn\'t supported. Try Download instead.',
  }
  const baseMsg = err ? (codes[err.code] || `Unknown playback error (code ${err.code})`) : 'Playback failed'
  const detail = err?.message || ''

  console.warn('[player] video error', {
    code: err?.code,
    message: detail,
    networkState: v.networkState,
    readyState: v.readyState,
    src: src.slice(0, 200),
  })
  streamError.value = detail ? `${baseMsg} — ${detail}` : baseMsg
}

// ------- controls -------

function togglePlay() {
  if (!videoEl.value) return
  if (videoEl.value.paused) videoEl.value.play().catch(() => {})
  else videoEl.value.pause()
}

function seek(deltaSec: number) {
  if (!videoEl.value) return
  videoEl.value.currentTime = Math.max(0, Math.min((duration.value || 0) - 0.1, videoEl.value.currentTime + deltaSec))
}

function seekTo(sec: number) {
  if (!videoEl.value) return
  videoEl.value.currentTime = Math.max(0, Math.min((duration.value || 0) - 0.1, sec))
}

function toggleMute() {
  if (!videoEl.value) return
  videoEl.value.muted = !videoEl.value.muted
}

function setVolume(v: number) {
  if (!videoEl.value) return
  const clamped = Math.max(0, Math.min(1, v))
  videoEl.value.volume = clamped
  if (clamped > 0 && videoEl.value.muted) videoEl.value.muted = false
}

async function toggleFullscreen() {
  if (!containerEl.value) return
  if (!document.fullscreenElement) {
    await containerEl.value.requestFullscreen?.().catch(() => {})
  } else {
    await document.exitFullscreen?.().catch(() => {})
  }
}

function onFsChange() { isFullscreen.value = !!document.fullscreenElement }

function gotoPrev() {
  if (props.prevEpisode) emit('goto', props.prevEpisode.season, props.prevEpisode.episode)
}
function gotoNext() {
  if (props.nextEpisode) emit('goto', props.nextEpisode.season, props.nextEpisode.episode)
}

// ------- progress bar dragging -------

const progressEl = ref<HTMLDivElement | null>(null)
const dragging = ref(false)

function pctFromEvent(e: MouseEvent | TouchEvent): number {
  if (!progressEl.value) return 0
  const rect = progressEl.value.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

function onProgressMouseDown(e: MouseEvent) {
  dragging.value = true
  seekTo(pctFromEvent(e) * (duration.value || 0))
  window.addEventListener('mousemove', onProgressMouseMove)
  window.addEventListener('mouseup', onProgressMouseUp)
}
function onProgressMouseMove(e: MouseEvent) {
  if (!dragging.value) return
  seekTo(pctFromEvent(e) * (duration.value || 0))
}
function onProgressMouseUp() {
  dragging.value = false
  window.removeEventListener('mousemove', onProgressMouseMove)
  window.removeEventListener('mouseup', onProgressMouseUp)
}
function onProgressTouchStart(e: TouchEvent) {
  dragging.value = true
  seekTo(pctFromEvent(e) * (duration.value || 0))
}
function onProgressTouchMove(e: TouchEvent) {
  if (!dragging.value) return
  seekTo(pctFromEvent(e) * (duration.value || 0))
}
function onProgressTouchEnd() { dragging.value = false }

// ------- auto-hide controls -------

function bumpControls() {
  showControls.value = true
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    if (playing.value && !showDownloadModal.value && !showCcMenu.value && !showCcCustomize.value) {
      showControls.value = false
    }
  }, 3000)
}

// ------- keyboard shortcuts -------

function onKey(e: KeyboardEvent) {
  // Ignore when typing in an input
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return

  switch (e.key) {
    case ' ':
      e.preventDefault(); togglePlay(); bumpControls(); break
    case 'ArrowLeft':
      e.preventDefault(); seek(e.shiftKey ? -30 : -10); bumpControls(); break
    case 'ArrowRight':
      e.preventDefault(); seek(e.shiftKey ? 30 : 10); bumpControls(); break
    case 'ArrowUp':
      e.preventDefault(); setVolume(volume.value + 0.05); bumpControls(); break
    case 'ArrowDown':
      e.preventDefault(); setVolume(volume.value - 0.05); bumpControls(); break
    case 'f': case 'F':
      e.preventDefault(); toggleFullscreen(); break
    case 'm': case 'M':
      e.preventDefault(); toggleMute(); bumpControls(); break
    case 'c': case 'C':
      if (subtitleTracks.value.length) {
        e.preventDefault(); toggleCc(); bumpControls()
      }
      break
    case 'n': case 'N':
      if (props.nextEpisode) { e.preventDefault(); gotoNext() }
      break
    case 'p': case 'P':
      if (props.prevEpisode) { e.preventDefault(); gotoPrev() }
      break
    case 'Escape':
      if (showCcCustomize.value) { showCcCustomize.value = false }
      else if (showCcMenu.value) { showCcMenu.value = false }
      else if (document.fullscreenElement) { /* fs handler will toggle */ }
      else exit()
      break
  }
}

function exit() {
  if (window.history.length > 1) router.back()
  else router.push('/library')
}

// ------- formatting -------

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const progressPct = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0)
const bufferedPct = computed(() => duration.value > 0 ? (buffered.value / duration.value) * 100 : 0)

// ------- lifecycle -------

function onDocClick() {
  // The button uses @click.stop, so clicks on it never reach here.
  // Clicks inside the menu also use @click.stop. Anything else closes it.
  if (showCcMenu.value) showCcMenu.value = false
}

onMounted(() => {
  prefs.value = loadPrefs()
  resolveStream()
  fetchSubtitles()
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('click', onDocClick)
  bumpControls()
})

onBeforeUnmount(() => {
  if (videoEl.value) {
    resume.set(props.tmdbId, videoEl.value.currentTime, videoEl.value.duration || 0, props.season, props.episode)
  }
  if (hideTimer) window.clearTimeout(hideTimer)
  if (saveTimer) window.clearTimeout(saveTimer)
  detachCueListener()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('mousemove', onProgressMouseMove)
  window.removeEventListener('mouseup', onProgressMouseUp)
})

// React to source changing (next-ep navigation without unmount)
watch(() => [props.link, props.directUrl], () => {
  streamUrl.value = null
  loadingStream.value = true
  streamError.value = null
  resolveStream()
})
</script>

<template>
  <div
    ref="containerEl"
    class="player-root"
    :class="{ 'controls-hidden': !showControls && playing }"
    @mousemove="bumpControls"
    @click.self="togglePlay"
  >
    <video
      ref="videoEl"
      class="player-video"
      :src="streamUrl || undefined"
      playsinline
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @progress="onProgress"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @volumechange="onVolumeChange"
      @error="onVideoError"
      @click="togglePlay"
    >
      <track
        v-for="t in subtitleTracks"
        :key="t.id"
        :id="t.id"
        kind="subtitles"
        :src="`/api/subtitle?u=${encodeURIComponent(t.url)}&format=${t.format}`"
        :srclang="t.language"
        :label="t.label + (t.hearingImpaired ? ' (CC)' : '')"
      >
    </video>

    <!-- Custom subtitle overlay (we render cues ourselves for full styling control) -->
    <div
      v-if="activeCueText.length"
      class="player-cue-container"
      :style="cueContainerStyle"
    >
      <div
        v-for="(line, i) in activeCueText"
        :key="i"
        class="player-cue"
        :style="cueStyle"
        v-html="formatCueText(line)"
      />
    </div>

    <div v-if="loadingStream" class="player-overlay">
      <div class="spinner large" />
      <div class="player-overlay-text">Resolving stream…</div>
    </div>

    <div v-else-if="streamError" class="player-overlay">
      <div class="player-overlay-title">Couldn't play this</div>
      <div class="player-overlay-text">{{ streamError }}</div>
      <button class="btn-outline player-overlay-btn" @click="exit">Go back</button>
    </div>

    <!-- Top bar -->
    <div class="player-top">
      <button class="player-icon-btn player-back-btn" aria-label="Back to library" @click="exit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        <span class="player-back-label">Back to library</span>
      </button>
      <div class="player-title-block">
        <div class="player-title">{{ title }}</div>
        <div v-if="subtitle" class="player-subtitle">{{ subtitle }}</div>
      </div>
      <button
        class="player-icon-btn"
        aria-label="Download"
        title="Download for offline"
        @click="showDownloadModal = true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>

    <!-- Center play button when paused -->
    <button v-if="!playing && streamUrl && !loadingStream" class="player-center-play" aria-label="Play" @click="togglePlay">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
    </button>

    <!-- Bottom controls -->
    <div class="player-bottom">
      <div
        ref="progressEl"
        class="player-progress"
        @mousedown="onProgressMouseDown"
        @touchstart.passive="onProgressTouchStart"
        @touchmove.passive="onProgressTouchMove"
        @touchend="onProgressTouchEnd"
      >
        <div class="player-progress-track">
          <div class="player-progress-buffered" :style="{ width: bufferedPct + '%' }" />
          <div class="player-progress-fill" :style="{ width: progressPct + '%' }" />
          <div class="player-progress-thumb" :style="{ left: progressPct + '%' }" />
        </div>
      </div>

      <div class="player-controls-row">
        <button class="player-icon-btn" :aria-label="playing ? 'Pause' : 'Play'" @click="togglePlay">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        </button>

        <button v-if="prevEpisode" class="player-icon-btn" aria-label="Previous episode" title="Previous (P)" @click="gotoPrev">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4" /><rect x="5" y="4" width="2" height="16" /></svg>
        </button>

        <button v-if="nextEpisode" class="player-icon-btn" aria-label="Next episode" title="Next (N)" @click="gotoNext">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20" /><rect x="17" y="4" width="2" height="16" /></svg>
        </button>

        <div class="player-volume">
          <button class="player-icon-btn" :aria-label="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
            <svg v-if="!muted && volume > 0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
            <svg v-else-if="!muted && volume > 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
          </button>
          <input
            type="range"
            class="player-volume-slider"
            min="0"
            max="1"
            step="0.01"
            :value="muted ? 0 : volume"
            :style="{ '--vol-pct': `${(muted ? 0 : volume) * 100}%` }"
            @input="setVolume(parseFloat(($event.target as HTMLInputElement).value))"
          >
        </div>

        <div class="player-time">{{ fmt(currentTime) }} / {{ fmt(duration) }}</div>

        <div class="player-spacer" />

        <div v-if="subtitlesAvailable" class="player-cc">
          <button
            class="player-icon-btn"
            :class="{ active: !!activeTrackId }"
            :aria-label="activeTrackId ? 'Subtitles on' : 'Subtitles off'"
            :title="loadingSubtitles ? 'Loading subtitles…' : (activeTrackId ? 'Subtitles on (C)' : 'Subtitles off (C)')"
            :disabled="!loadingSubtitles && subtitleTracks.length === 0"
            @click.stop="showCcMenu = !showCcMenu; showCcCustomize = false"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
              <path d="M7 11h2M7 14h4M14 11h3M14 14h3" />
            </svg>
          </button>

          <Transition name="cc-menu">
            <div v-if="showCcMenu" class="player-cc-menu" @click.stop>
              <div class="player-cc-menu-header">
                <span>Subtitles</span>
                <button
                  class="player-cc-customize-link"
                  @click="showCcCustomize = true; showCcMenu = false"
                >
                  Customize
                </button>
              </div>

              <button
                class="player-cc-menu-item"
                :class="{ active: activeTrackId == null }"
                @click="selectTrack(null)"
              >
                <span class="player-cc-check">
                  <svg v-if="activeTrackId == null" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span>Off</span>
              </button>

              <div v-if="loadingSubtitles && subtitleTracks.length === 0" class="player-cc-menu-empty">
                <div class="spinner" /> Loading…
              </div>

              <div v-else-if="subtitleTracks.length === 0" class="player-cc-menu-empty">
                No subtitles found
              </div>

              <button
                v-for="t in subtitleTracks"
                :key="t.id"
                class="player-cc-menu-item"
                :class="{ active: t.id === activeTrackId }"
                @click="selectTrack(t.id)"
              >
                <span class="player-cc-check">
                  <svg v-if="t.id === activeTrackId" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span class="player-cc-menu-label">
                  {{ t.label }}
                  <span v-if="t.hearingImpaired" class="player-cc-badge">CC</span>
                </span>
              </button>
            </div>
          </Transition>
        </div>

        <button class="player-icon-btn" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
          <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
        </button>
      </div>
    </div>

    <Transition name="cc-customize">
      <div
        v-if="showCcCustomize"
        class="player-cc-customize-backdrop"
        @click.self="showCcCustomize = false"
      >
        <div class="player-cc-customize" @click.stop>
          <div class="player-cc-customize-header">
            <span>Caption style</span>
            <button class="player-cc-customize-close" aria-label="Close" @click="showCcCustomize = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div class="player-cc-customize-preview">
            <div class="player-cue" :style="cueStyle">The quick brown fox</div>
          </div>

          <div class="player-cc-customize-grid">
            <label class="player-cc-field">
              <span>Font</span>
              <select :value="prefs.fontFamily" @change="updatePref('fontFamily', ($event.target as HTMLSelectElement).value)">
                <option v-for="f in FONT_FAMILIES" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </label>

            <label class="player-cc-field">
              <span>Size <em>{{ Math.round(prefs.fontScale * 100) }}%</em></span>
              <input
                type="range" min="0.6" max="2.4" step="0.05"
                :value="prefs.fontScale"
                @input="updatePref('fontScale', parseFloat(($event.target as HTMLInputElement).value))"
              >
            </label>

            <label class="player-cc-field">
              <span>Edge style</span>
              <select :value="prefs.edgeStyle" @change="updatePref('edgeStyle', ($event.target as HTMLSelectElement).value as any)">
                <option value="none">None</option>
                <option value="shadow">Drop shadow</option>
                <option value="outline">Outline</option>
                <option value="raised">Raised</option>
                <option value="depressed">Depressed</option>
              </select>
            </label>

            <label class="player-cc-field">
              <span>Position <em>{{ prefs.position }}%</em></span>
              <input
                type="range" min="20" max="98" step="1"
                :value="prefs.position"
                @input="updatePref('position', parseInt(($event.target as HTMLInputElement).value, 10))"
              >
            </label>

            <label class="player-cc-field">
              <span>Text color</span>
              <div class="player-cc-color-row">
                <input
                  type="color" :value="prefs.textColor"
                  @input="updatePref('textColor', ($event.target as HTMLInputElement).value)"
                >
                <input
                  type="range" min="0.2" max="1" step="0.05"
                  :value="prefs.textOpacity"
                  :title="`Text opacity ${Math.round(prefs.textOpacity * 100)}%`"
                  @input="updatePref('textOpacity', parseFloat(($event.target as HTMLInputElement).value))"
                >
              </div>
            </label>

            <label class="player-cc-field">
              <span>Background</span>
              <div class="player-cc-color-row">
                <input
                  type="color" :value="prefs.bgColor"
                  @input="updatePref('bgColor', ($event.target as HTMLInputElement).value)"
                >
                <input
                  type="range" min="0" max="1" step="0.05"
                  :value="prefs.bgOpacity"
                  :title="`Background opacity ${Math.round(prefs.bgOpacity * 100)}%`"
                  @input="updatePref('bgOpacity', parseFloat(($event.target as HTMLInputElement).value))"
                >
              </div>
            </label>
          </div>

          <div class="player-cc-customize-footer">
            <button class="player-cc-customize-reset" @click="resetPrefs">Reset to defaults</button>
            <button class="player-cc-customize-done" @click="showCcCustomize = false">Done</button>
          </div>
        </div>
      </div>
    </Transition>

    <DownloadModal
      v-if="showDownloadModal"
      :link="link"
      :direct-url="directUrl"
      :bytes="bytes"
      :filename="filename"
      :title="title"
      :subtitle="subtitle"
      :tmdb-id="tmdbId"
      :season="season"
      :episode="episode"
      @close="showDownloadModal = false"
    />
  </div>
</template>
