<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { library, syncing, syncNow } = useLibrary()

const tmdbId = computed(() => Number(route.params.tmdbId))
const movie = computed(() => library.value.movies.find(m => m.tmdbId === tmdbId.value) || null)

// Direct-play payload set by router.push({ state: { directUrl, ... } }) from
// the DetailView's "Watch" button. Lets us play a title that hasn't synced
// into the library yet, with no extra round-trip. Lost on hard refresh —
// in that case we fall back to the library lookup.
interface DirectPayload {
  directUrl: string
  filename: string
  bytes: number
  title: string
  subtitle?: string
  imdbId?: string
}
const direct = ref<DirectPayload | null>(null)
onMounted(() => {
  const s = (history.state || {}) as Partial<DirectPayload>
  if (s.directUrl) {
    direct.value = {
      directUrl: s.directUrl,
      filename: s.filename || 'movie.mp4',
      bytes: Number(s.bytes) || 0,
      title: s.title || 'Untitled',
      subtitle: s.subtitle,
      imdbId: s.imdbId,
    }
  }
  // If no direct payload and no library hit, kick a sync to populate cache.
  if (!direct.value && !movie.value && !syncing.value && library.value.movies.length === 0) {
    syncNow({ silent: true })
  }
})

function exit() { router.back() }

const librarySubtitle = computed(() => {
  if (!movie.value) return ''
  const parts = []
  if (movie.value.year) parts.push(String(movie.value.year))
  if (movie.value.runtime) parts.push(`${movie.value.runtime} min`)
  return parts.join(' · ')
})
</script>

<template>
  <Player
    v-if="direct"
    :tmdb-id="tmdbId"
    :title="direct.title"
    :subtitle="direct.subtitle"
    :direct-url="direct.directUrl"
    :bytes="direct.bytes"
    :filename="direct.filename"
    :imdb-id="direct.imdbId"
  />

  <Player
    v-else-if="movie"
    :tmdb-id="movie.tmdbId"
    :title="movie.title"
    :subtitle="librarySubtitle"
    :link="movie.file.link"
    :bytes="movie.file.bytes"
    :filename="movie.file.filename"
    :imdb-id="movie.imdbId || undefined"
  />

  <div v-else-if="syncing" class="player-fullscreen-empty">
    <div class="spinner large" />
    <div class="player-overlay-text">Loading library…</div>
  </div>

  <div v-else class="player-fullscreen-empty">
    <div class="player-overlay-title">Not in your library</div>
    <div class="player-overlay-text">This title isn't synced yet. Try syncing on the Library page.</div>
    <button class="btn-outline player-overlay-btn" @click="exit">Go back</button>
  </div>
</template>
