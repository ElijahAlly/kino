<script setup lang="ts">
const { showToast } = useToast()

const query = ref('')
const results = ref<any[]>([])
const page = ref(1)
const totalPages = ref(0)
const loading = ref(false)
const loadingMore = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function debounceSearch(val: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!val.trim()) {
    results.value = []
    page.value = 1
    totalPages.value = 0
    loading.value = false
    return
  }
  loading.value = true
  debounceTimer = setTimeout(() => doSearch(val), 300)
}

async function doSearch(q: string) {
  try {
    page.value = 1
    const data = await $fetch<any>('/api/search', { params: { q, page: 1 } })
    results.value = (data.results || []).filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    totalPages.value = data.total_pages || 0
  } catch {
    showToast('Search failed. Please try again.', 'error')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    page.value++
    const data = await $fetch<any>('/api/search', { params: { q: query.value, page: page.value } })
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

function clearSearch() {
  query.value = ''
  results.value = []
  page.value = 1
  totalPages.value = 0
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
    <div class="search-container">
      <div class="search-bar">
        <span class="search-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </span>
        <input
          v-model="query"
          type="text"
          class="search-input"
          placeholder="Search movies & TV shows..."
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @input="debounceSearch(query)"
        >
        <button class="search-clear" :class="{ visible: query }" @click="clearSearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </div>

    <div v-if="loading && results.length === 0" class="content-grid">
      <div v-for="i in 6" :key="i" class="card">
        <div class="skeleton-poster" />
        <div class="skeleton-text" />
        <div class="skeleton-text-short" />
      </div>
    </div>

    <div v-else-if="results.length > 0">
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

    <div v-else-if="!query" class="search-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
      <p>Search for movies & TV shows</p>
    </div>
  </div>
</template>
