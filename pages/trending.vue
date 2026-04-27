<script setup lang="ts">
const { showToast } = useToast()

const results = ref<any[]>([])
const page = ref(1)
const totalPages = ref(0)
const loading = ref(true)
const loadingMore = ref(false)

onMounted(async () => {
  try {
    const data = await $fetch<any>('/api/trending')
    results.value = (data.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    totalPages.value = data.total_pages || 0
  } catch {
    showToast('Failed to load trending.', 'error')
  } finally {
    loading.value = false
  }
})

async function loadMore() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    page.value++
    const data = await $fetch<any>('/api/trending', { params: { page: page.value } })
    const items = (data.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    results.value = [...results.value, ...items]
    totalPages.value = data.total_pages || 0
  } catch {
    showToast('Failed to load more.', 'error')
    page.value--
  } finally {
    loadingMore.value = false
  }
}

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null
}

function yearFrom(date: string | null) {
  return date ? date.substring(0, 4) : ''
}
</script>

<template>
  <div class="page-enter">
    <div class="page-header">
      <h1 class="page-title">Trending</h1>
    </div>

    <div v-if="loading" class="content-grid">
      <div v-for="i in 6" :key="i" class="card">
        <div class="skeleton-poster" />
        <div class="skeleton-text" />
        <div class="skeleton-text-short" />
      </div>
    </div>

    <div v-else-if="results.length">
      <div class="content-grid">
        <NuxtLink
          v-for="item in results"
          :key="item.id"
          :to="`/${item.media_type}/${item.id}`"
          class="card"
        >
          <div class="card-poster">
            <img v-if="posterUrl(item.poster_path)" :src="posterUrl(item.poster_path)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
            </div>
          </div>
          <div class="card-info">
            <div class="card-title">{{ item.title || item.name }}</div>
            <div class="card-meta">
              <span v-if="yearFrom(item.release_date || item.first_air_date)">{{ yearFrom(item.release_date || item.first_air_date) }}</span>
              <span class="type-badge">{{ item.media_type === 'movie' ? 'Movie' : 'TV' }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>

      <div v-if="page < totalPages" class="load-more-container">
        <button class="load-more-btn" :class="{ loading: loadingMore }" @click="loadMore">
          {{ loadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </div>

    <div v-else class="empty-state">
      <p>Could not load trending titles.</p>
    </div>
  </div>
</template>
