<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { library, syncing, syncNow } = useLibrary()
const { progress } = useResume()

const tmdbId = computed(() => Number(route.params.tmdbId))
const show = computed(() => library.value.tv.find(s => s.tmdbId === tmdbId.value) || null)

// Group episodes by season for display.
const seasons = computed(() => {
  if (!show.value) return []
  const map = new Map<number, typeof show.value.episodes>()
  for (const ep of show.value.episodes) {
    const arr = map.get(ep.season) || []
    arr.push(ep)
    map.set(ep.season, arr)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => ({
      season,
      episodes: [...episodes].sort((a, b) => a.episode - b.episode),
    }))
})

onMounted(() => {
  if (!show.value && !syncing.value && library.value.tv.length === 0) {
    syncNow({ silent: true })
  }
})

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null
}

function epLink(season: number, episode: number) {
  return `/play/tv/${tmdbId.value}/${season}/${episode}`
}

function fmtRuntime(min: number | null) {
  if (!min) return ''
  return `${min}m`
}

function exit() {
  if (window.history.length > 1) router.back()
  else router.push('/library')
}
</script>

<template>
  <div v-if="show" class="page-enter">
    <button class="back-btn" aria-label="Back" @click="exit">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>

    <div class="show-header">
      <div class="show-poster">
        <img v-if="posterUrl(show.posterPath)" :src="posterUrl(show.posterPath)!" :alt="show.title">
        <div v-else class="card-poster-fallback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
        </div>
      </div>
      <div class="show-meta">
        <h1 class="show-title">{{ show.title }}</h1>
        <div class="show-stats">{{ show.episodes.length }} episode{{ show.episodes.length === 1 ? '' : 's' }} in library</div>
      </div>
    </div>

    <div v-for="grp in seasons" :key="grp.season" class="season-block">
      <h3 class="season-block-title">Season {{ grp.season }}</h3>
      <div class="ep-rows">
        <NuxtLink
          v-for="ep in grp.episodes"
          :key="`${ep.season}-${ep.episode}`"
          :to="epLink(ep.season, ep.episode)"
          class="ep-row"
        >
          <div class="ep-num">E{{ ep.episode }}</div>
          <div class="ep-info">
            <div class="ep-name">{{ ep.name || `Episode ${ep.episode}` }}</div>
            <div class="ep-meta">
              <span v-if="ep.runtime">{{ fmtRuntime(ep.runtime) }}</span>
              <span v-else>—</span>
            </div>
            <div v-if="progress(tmdbId, ep.season, ep.episode) > 0.02" class="ep-resume-bar">
              <div class="ep-resume-fill" :style="{ width: `${progress(tmdbId, ep.season, ep.episode) * 100}%` }" />
            </div>
          </div>
          <svg class="ep-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </NuxtLink>
      </div>
    </div>
  </div>

  <div v-else-if="syncing" class="empty-state">
    <div class="spinner large" />
    <p>Loading library…</p>
  </div>

  <div v-else class="page-enter">
    <button class="back-btn" aria-label="Back" @click="exit">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
    <div class="empty-state">
      <p class="empty-title">Show not in library</p>
      <p>Sync the library or add episodes from the show's detail page.</p>
    </div>
  </div>
</template>
