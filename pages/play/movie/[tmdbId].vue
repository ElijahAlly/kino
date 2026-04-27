<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { library, syncing, syncNow } = useLibrary()

const tmdbId = computed(() => Number(route.params.tmdbId))
const movie = computed(() => library.value.movies.find(m => m.tmdbId === tmdbId.value) || null)

// If we land here on a fresh tab with empty cache, kick a sync.
onMounted(() => {
  if (!movie.value && !syncing.value && library.value.movies.length === 0) {
    syncNow({ silent: true })
  }
})

function exit() { router.back() }

const subtitle = computed(() => {
  if (!movie.value) return ''
  const parts = []
  if (movie.value.year) parts.push(String(movie.value.year))
  if (movie.value.runtime) parts.push(`${movie.value.runtime} min`)
  return parts.join(' · ')
})
</script>

<template>
  <Player
    v-if="movie"
    :tmdb-id="movie.tmdbId"
    :title="movie.title"
    :subtitle="subtitle"
    :link="movie.file.link"
    :bytes="movie.file.bytes"
    :filename="movie.file.filename"
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
