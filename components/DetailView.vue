<script setup lang="ts">
const props = defineProps<{
  type: 'movie' | 'tv'
  tmdbId: number
}>()

const router = useRouter()
const { showToast } = useToast()
const { saveToLibrary, isInLibrary } = useLibrary()
const { ensureAuth, clearAuth } = useAuth()

function goBack() {
  // window.history.length > 1 means there's somewhere to go back to.
  // (1 = fresh tab opened directly to this URL.)
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

const detail = ref<any>(null)
const loading = ref(true)
const seasonData = ref<any>(null)
const selectedSeason = ref('')
const loadingSeason = ref(false)
const addingLibrary = ref(false)
const addedToLibrary = ref(false)
const addingSeason = ref(false)
const seasonProgress = ref('')
const episodeStates = ref<Record<string, 'loading' | 'added' | 'error'>>({})
const showTrailer = ref(false)

const inLibrary = computed(() => isInLibrary(props.tmdbId) || addedToLibrary.value)

const title = computed(() => detail.value?.title || detail.value?.name || 'Untitled')
const year = computed(() => {
  const d = detail.value?.release_date || detail.value?.first_air_date
  return d ? d.substring(0, 4) : ''
})
const vote = computed(() => detail.value?.vote_average ? detail.value.vote_average.toFixed(1) : null)
const ratingClass = computed(() => {
  const v = parseFloat(vote.value || '0')
  if (v >= 7) return 'good'
  if (v >= 5) return 'mid'
  return 'bad'
})
const runtime = computed(() => detail.value?.runtime ? `${detail.value.runtime} min` : null)
const seasonsLabel = computed(() => detail.value?.number_of_seasons
  ? `${detail.value.number_of_seasons} Season${detail.value.number_of_seasons > 1 ? 's' : ''}`
  : null,
)
const genres = computed(() => detail.value?.genres || [])
const overview = computed(() => detail.value?.overview || '')
const imdbId = computed(() => detail.value?.imdb_id || detail.value?.external_ids?.imdb_id || null)
const trailer = computed(() => {
  const videos = detail.value?.videos?.results || []
  return videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube')
})
const cast = computed(() => (detail.value?.credits?.cast || []).slice(0, 20))
const similar = computed(() => (detail.value?.similar?.results || []).slice(0, 10))
const tvSeasons = computed(() => {
  if (props.type !== 'tv' || !detail.value?.seasons) return []
  return detail.value.seasons.filter((s: any) => s.season_number > 0)
})

watch(() => props.tmdbId, async () => { await fetchDetail() }, { immediate: true })

async function fetchDetail() {
  loading.value = true
  detail.value = null
  seasonData.value = null
  selectedSeason.value = ''
  episodeStates.value = {}
  addedToLibrary.value = false
  try {
    detail.value = await $fetch('/api/details', { params: { id: props.tmdbId, type: props.type } })
  } catch {
    showToast('Failed to load details.', 'error')
  } finally {
    loading.value = false
  }
}

async function loadSeason(num: string) {
  if (!num) { seasonData.value = null; return }
  loadingSeason.value = true
  episodeStates.value = {}
  try {
    seasonData.value = await $fetch('/api/season', { params: { id: props.tmdbId, season: num } })
  } catch {
    showToast('Failed to load season data.', 'error')
  } finally {
    loadingSeason.value = false
  }
}

async function addToLibrary() {
  if (!imdbId.value) { showToast('No IMDb ID available.', 'error'); return }
  const secret = await ensureAuth()
  if (!secret) return

  addingLibrary.value = true
  try {
    const result = await $fetch<any>('/api/watch', {
      method: 'POST',
      headers: { 'X-App-Secret': secret },
      body: { imdbId: imdbId.value },
    })
    if (!result.success) {
      showToast(result.error || 'Not available.', 'error')
      return
    }
    addedToLibrary.value = true
    saveToLibrary({
      tmdbId: props.tmdbId,
      imdbId: imdbId.value,
      title: title.value,
      posterPath: detail.value?.poster_path || null,
      type: props.type,
      addedAt: Date.now(),
    })
    showToast(`${title.value} added to library!`, 'success')
  } catch (err: any) {
    if (err.status === 401 || err.statusCode === 401) {
      clearAuth()
      showToast('Invalid passphrase.', 'error')
    } else {
      showToast('Failed to add. Try again.', 'error')
    }
  } finally {
    addingLibrary.value = false
  }
}

async function addEpisode(season: number, episode: number) {
  if (!imdbId.value) { showToast('No IMDb ID.', 'error'); return }
  const secret = await ensureAuth()
  if (!secret) return

  const key = `${season}-${episode}`
  episodeStates.value[key] = 'loading'

  try {
    const result = await $fetch<any>('/api/watch', {
      method: 'POST',
      headers: { 'X-App-Secret': secret },
      body: { imdbId: imdbId.value, season, episode },
    })
    if (!result.success) {
      episodeStates.value[key] = 'error'
      showToast(result.error || `S${season}E${episode} not available.`, 'error')
      return
    }
    episodeStates.value[key] = 'added'
    showToast(`S${season}E${episode} added!`, 'success')
  } catch (err: any) {
    episodeStates.value[key] = 'error'
    if (err.status === 401 || err.statusCode === 401) {
      clearAuth()
      showToast('Invalid passphrase.', 'error')
    } else {
      showToast(`Failed to add S${season}E${episode}.`, 'error')
    }
  }
}

async function addEntireSeason() {
  if (!imdbId.value) { showToast('No IMDb ID.', 'error'); return }
  const secret = await ensureAuth()
  if (!secret) return

  const seasonNum = Number(selectedSeason.value)
  const episodes = seasonData.value?.episodes || []
  addingSeason.value = true
  let added = 0
  let failed = 0

  for (const ep of episodes) {
    seasonProgress.value = `Adding episode ${added + failed + 1} of ${episodes.length}...`
    const key = `${seasonNum}-${ep.episode_number}`
    episodeStates.value[key] = 'loading'

    try {
      const result = await $fetch<any>('/api/watch', {
        method: 'POST',
        headers: { 'X-App-Secret': secret },
        body: { imdbId: imdbId.value, season: seasonNum, episode: ep.episode_number },
      })
      if (!result.success) {
        episodeStates.value[key] = 'error'
        failed++
      } else {
        episodeStates.value[key] = 'added'
        added++
      }
    } catch (err: any) {
      episodeStates.value[key] = 'error'
      failed++
      if (err.status === 401 || err.statusCode === 401) {
        clearAuth()
        showToast('Invalid passphrase.', 'error')
        addingSeason.value = false
        seasonProgress.value = ''
        return
      }
    }
  }

  addingSeason.value = false
  seasonProgress.value = ''

  if (failed === 0) {
    saveToLibrary({
      tmdbId: props.tmdbId,
      imdbId: imdbId.value,
      title: title.value,
      posterPath: detail.value?.poster_path || null,
      type: 'tv',
      addedAt: Date.now(),
    })
    showToast(`Season ${seasonNum} added! (${added} episodes)`, 'success')
  } else {
    showToast(`Added ${added}, ${failed} failed.`, 'error')
  }
}

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null
}
function backdropUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : null
}
function profileUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null
}
function epStateClass(season: string, ep: number) {
  return episodeStates.value[`${season}-${ep}`]
}
</script>

<template>
  <div v-if="loading" class="page-enter">
    <button class="back-btn" aria-label="Back" @click="goBack">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
    <div class="skeleton-hero" />
    <div class="skeleton-detail-header">
      <div class="skeleton-detail-poster" />
      <div class="skeleton-detail-info">
        <div class="skeleton-line h24 w80" />
        <div class="skeleton-line w60" />
        <div class="skeleton-line w40" />
      </div>
    </div>
    <div class="skeleton-line h48" style="margin-bottom:12px" />
    <div class="skeleton-line w80" style="margin-bottom:8px" />
    <div class="skeleton-line w60" />
  </div>

  <div v-else-if="detail" class="page-enter">
    <button class="back-btn" aria-label="Back" @click="goBack">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
    <div class="detail-hero">
      <img v-if="detail.backdrop_path" class="detail-backdrop" :src="backdropUrl(detail.backdrop_path)!" alt="">
      <div v-else class="detail-backdrop-fallback" />
      <div class="detail-hero-gradient" />
    </div>

    <div class="detail-header">
      <div class="detail-poster">
        <img v-if="detail.poster_path" :src="posterUrl(detail.poster_path)!" :alt="title">
        <div v-else class="card-poster-fallback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
        </div>
      </div>
      <div class="detail-title-area">
        <h1 class="detail-title">{{ title }}</h1>
        <div class="detail-meta">
          <span v-if="year">{{ year }}</span>
          <span v-if="vote" class="rating-badge" :class="ratingClass">&#9733; {{ vote }}</span>
          <span v-if="runtime">{{ runtime }}</span>
          <span v-if="seasonsLabel">{{ seasonsLabel }}</span>
        </div>
      </div>
    </div>

    <div v-if="genres.length" class="detail-genres">
      <span v-for="g in genres" :key="g.id" class="genre-tag">{{ g.name }}</span>
    </div>

    <div class="detail-actions">
      <button
        v-if="type === 'movie'"
        class="btn-primary"
        :class="{ loading: addingLibrary, 'in-library': inLibrary && !addedToLibrary, success: addedToLibrary }"
        :disabled="addingLibrary || inLibrary"
        @click="addToLibrary"
      >
        <template v-if="addingLibrary">
          <div class="spinner" /> Adding...
        </template>
        <template v-else-if="inLibrary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><polyline points="20 6 9 17 4 12" /></svg>
          {{ addedToLibrary ? 'Added!' : 'In Library' }}
        </template>
        <template v-else>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:18px;height:18px"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add to Library
        </template>
      </button>

      <button
        v-if="trailer"
        class="btn-outline"
        @click="showTrailer = true"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        Watch Trailer
      </button>
    </div>

    <div v-if="overview" class="detail-overview">
      <h3>Overview</h3>
      <p>{{ overview }}</p>
    </div>

    <div v-if="cast.length" class="cast-section">
      <h3>Cast</h3>
      <div class="cast-row">
        <div v-for="c in cast" :key="c.id" class="cast-item">
          <div class="cast-avatar">
            <img v-if="c.profile_path" :src="profileUrl(c.profile_path)!" :alt="c.name" loading="lazy">
            <div v-else class="cast-avatar-fallback">{{ c.name?.[0] || '?' }}</div>
          </div>
          <div class="cast-name">{{ c.name }}</div>
          <div v-if="c.character" class="cast-character">{{ c.character }}</div>
        </div>
      </div>
    </div>

    <div v-if="type === 'tv' && tvSeasons.length" class="season-section">
      <h3>Seasons</h3>
      <select v-model="selectedSeason" class="season-select" @change="loadSeason(selectedSeason)">
        <option value="">Select a season</option>
        <option v-for="s in tvSeasons" :key="s.season_number" :value="String(s.season_number)">
          Season {{ s.season_number }} ({{ s.episode_count }} episodes)
        </option>
      </select>

      <div v-if="loadingSeason" style="display:flex;justify-content:center;padding:24px">
        <div class="spinner" />
      </div>

      <div v-else-if="seasonData">
        <button
          class="add-season-btn"
          :class="{ loading: addingSeason }"
          :disabled="addingSeason"
          @click="addEntireSeason"
        >
          <template v-if="addingSeason">
            <div class="spinner" /> Adding Season...
          </template>
          <template v-else>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Entire Season {{ selectedSeason }}
          </template>
        </button>
        <div v-if="seasonProgress" class="season-progress">{{ seasonProgress }}</div>

        <div class="episode-list">
          <div v-for="ep in seasonData.episodes" :key="ep.episode_number" class="episode-item">
            <div class="episode-number">{{ ep.episode_number }}</div>
            <div class="episode-info">
              <div class="episode-title">{{ ep.name || `Episode ${ep.episode_number}` }}</div>
              <div v-if="ep.runtime" class="episode-meta">{{ ep.runtime }} min</div>
            </div>
            <button
              class="episode-add-btn"
              :class="{
                loading: epStateClass(selectedSeason, ep.episode_number) === 'loading',
                added: epStateClass(selectedSeason, ep.episode_number) === 'added',
              }"
              :disabled="epStateClass(selectedSeason, ep.episode_number) === 'loading' || epStateClass(selectedSeason, ep.episode_number) === 'added'"
              @click="addEpisode(Number(selectedSeason), ep.episode_number)"
            >
              <svg v-if="epStateClass(selectedSeason, ep.episode_number) === 'added'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polyline points="20 6 9 17 4 12" /></svg>
              <div v-else-if="epStateClass(selectedSeason, ep.episode_number) === 'loading'" class="spinner" style="width:16px;height:16px;border-width:2px" />
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="similar.length" class="similar-section">
      <h3>Similar Titles</h3>
      <div class="similar-row">
        <NuxtLink
          v-for="s in similar"
          :key="s.id"
          :to="`/${type}/${s.id}`"
          class="similar-card card"
        >
          <div class="card-poster">
            <img v-if="posterUrl(s.poster_path)" :src="posterUrl(s.poster_path)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
            </div>
          </div>
          <div class="card-title">{{ s.title || s.name }}</div>
        </NuxtLink>
      </div>
    </div>
  </div>

  <div v-else class="page-enter">
    <button class="back-btn" aria-label="Back" @click="goBack">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
    </button>
    <div class="empty-state">
      <p>Could not load details.</p>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="showTrailer && trailer" class="trailer-overlay" @click.self="showTrailer = false">
        <button class="trailer-close" aria-label="Close" @click="showTrailer = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <div class="trailer-frame">
          <iframe
            :src="`https://www.youtube.com/embed/${trailer.key}?autoplay=1&rel=0&modestbranding=1`"
            title="Trailer"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
