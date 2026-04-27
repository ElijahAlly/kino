<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { library, syncing, syncNow } = useLibrary()

const tmdbId = computed(() => Number(route.params.tmdbId))
const seasonNum = computed(() => Number(route.params.season))
const episodeNum = computed(() => Number(route.params.episode))

const show = computed(() => library.value.tv.find(s => s.tmdbId === tmdbId.value) || null)

const sortedEps = computed(() => {
  if (!show.value) return []
  return [...show.value.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
})

const currentIdx = computed(() => {
  return sortedEps.value.findIndex(e => e.season === seasonNum.value && e.episode === episodeNum.value)
})

const currentEp = computed(() => currentIdx.value >= 0 ? sortedEps.value[currentIdx.value] : null)
const prevEpisode = computed(() => currentIdx.value > 0 ? sortedEps.value[currentIdx.value - 1] : null)
const nextEpisode = computed(() => {
  const i = currentIdx.value
  return i >= 0 && i < sortedEps.value.length - 1 ? sortedEps.value[i + 1] : null
})

onMounted(() => {
  if (!show.value && !syncing.value && library.value.tv.length === 0) {
    syncNow({ silent: true })
  }
})

function exit() { router.back() }

function gotoEp(season: number, episode: number) {
  router.replace(`/play/tv/${tmdbId.value}/${season}/${episode}`)
}

const subtitle = computed(() => {
  if (!show.value || !currentEp.value) return ''
  const ep = currentEp.value
  const parts = [
    `S${ep.season}E${ep.episode}`,
    ep.name || '',
    ep.runtime ? `${ep.runtime}m` : '',
  ].filter(Boolean)
  return parts.join(' · ')
})
</script>

<template>
  <Player
    v-if="show && currentEp"
    :tmdb-id="show.tmdbId"
    :season="currentEp.season"
    :episode="currentEp.episode"
    :title="show.title"
    :subtitle="subtitle"
    :link="currentEp.file.link"
    :bytes="currentEp.file.bytes"
    :filename="currentEp.file.filename"
    :prev-episode="prevEpisode"
    :next-episode="nextEpisode"
    :show-tmdb-id="show.tmdbId"
    @goto="gotoEp"
  />

  <div v-else-if="syncing" class="player-fullscreen-empty">
    <div class="spinner large" />
    <div class="player-overlay-text">Loading library…</div>
  </div>

  <div v-else class="player-fullscreen-empty">
    <div class="player-overlay-title">Episode not in library</div>
    <div class="player-overlay-text">Try syncing on the Library page or adding the episode from the show's detail page.</div>
    <button class="btn-outline player-overlay-btn" @click="exit">Go back</button>
  </div>
</template>
