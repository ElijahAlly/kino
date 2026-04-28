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

function onVideoError() {
  // Triggered when the browser can't load/decode the file. Surface as much
  // diagnostic info as the element exposes — code 4 is ambiguous (it can mean
  // "unsupported codec", "wrong Content-Type", or "URL unreachable") and we
  // want to be able to tell which.
  if (!videoEl.value) return
  const v = videoEl.value
  const err = v.error
  const codes: Record<number, string> = {
    1: 'Playback aborted',
    2: 'Network error while loading the file',
    3: 'Decoding error — codec not supported',
    4: 'File format isn\'t supported — try downloading it as MP4 instead',
  }
  const baseMsg = err ? (codes[err.code] || `Unknown playback error (code ${err.code})`) : 'Playback failed'
  const detail = err?.message || ''

  const diag = {
    code: err?.code,
    message: detail,
    networkState: v.networkState,
    readyState: v.readyState,
    src: v.currentSrc?.slice(0, 200),
  }
  console.warn('[player] video error', diag)
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
    if (playing.value && !showDownloadModal.value) showControls.value = false
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
    case 'n': case 'N':
      if (props.nextEpisode) { e.preventDefault(); gotoNext() }
      break
    case 'p': case 'P':
      if (props.prevEpisode) { e.preventDefault(); gotoPrev() }
      break
    case 'Escape':
      if (document.fullscreenElement) { /* fs handler will toggle */ }
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

onMounted(() => {
  resolveStream()
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFsChange)
  bumpControls()
})

onBeforeUnmount(() => {
  if (videoEl.value) {
    resume.set(props.tmdbId, videoEl.value.currentTime, videoEl.value.duration || 0, props.season, props.episode)
  }
  if (hideTimer) window.clearTimeout(hideTimer)
  if (saveTimer) window.clearTimeout(saveTimer)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFsChange)
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
    />

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

        <button class="player-icon-btn" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
          <svg v-if="!isFullscreen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
        </button>
      </div>
    </div>

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
