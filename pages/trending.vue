<script setup lang="ts">
interface Row {
  key: string
  title: string
  endpoint: string
  params?: Record<string, string>
  defaultMediaType: 'movie' | 'tv'
}

const rows: Row[] = [
  { key: 'trending', title: 'Trending This Week', endpoint: '/api/trending', defaultMediaType: 'movie' },
  { key: 'just-released', title: 'Just Released', endpoint: '/api/discover', params: { category: 'just-released' }, defaultMediaType: 'movie' },
  { key: 'popular-movies', title: 'Popular Movies', endpoint: '/api/discover', params: { category: 'popular-movies' }, defaultMediaType: 'movie' },
  { key: 'popular-tv', title: 'Popular TV', endpoint: '/api/discover', params: { category: 'popular-tv' }, defaultMediaType: 'tv' },

  // Streaming platforms
  { key: 'platform-netflix', title: 'On Netflix', endpoint: '/api/discover', params: { category: 'platform-netflix' }, defaultMediaType: 'movie' },
  { key: 'platform-max', title: 'On Max', endpoint: '/api/discover', params: { category: 'platform-max' }, defaultMediaType: 'movie' },
  { key: 'platform-disney', title: 'On Disney+', endpoint: '/api/discover', params: { category: 'platform-disney' }, defaultMediaType: 'movie' },
  { key: 'platform-prime', title: 'On Prime Video', endpoint: '/api/discover', params: { category: 'platform-prime' }, defaultMediaType: 'movie' },
  { key: 'platform-apple', title: 'On Apple TV+', endpoint: '/api/discover', params: { category: 'platform-apple' }, defaultMediaType: 'movie' },
  { key: 'platform-hulu', title: 'On Hulu', endpoint: '/api/discover', params: { category: 'platform-hulu' }, defaultMediaType: 'movie' },
  { key: 'platform-paramount', title: 'On Paramount+', endpoint: '/api/discover', params: { category: 'platform-paramount' }, defaultMediaType: 'movie' },
  { key: 'platform-peacock', title: 'On Peacock', endpoint: '/api/discover', params: { category: 'platform-peacock' }, defaultMediaType: 'movie' },

  // Studios & curated
  { key: 'a24', title: 'A24', endpoint: '/api/discover', params: { category: 'a24' }, defaultMediaType: 'movie' },
  { key: 'blockbusters', title: 'Blockbusters', endpoint: '/api/discover', params: { category: 'blockbusters' }, defaultMediaType: 'movie' },
  { key: 'top-rated', title: 'Top Rated', endpoint: '/api/discover', params: { category: 'top-rated' }, defaultMediaType: 'movie' },
  { key: 'action', title: 'Action', endpoint: '/api/discover', params: { category: 'action' }, defaultMediaType: 'movie' },
  { key: 'comedy', title: 'Comedy', endpoint: '/api/discover', params: { category: 'comedy' }, defaultMediaType: 'movie' },
  { key: 'anime', title: 'Anime', endpoint: '/api/discover', params: { category: 'anime' }, defaultMediaType: 'tv' },
  { key: 'black-films', title: 'Black Films', endpoint: '/api/discover', params: { category: 'black-films' }, defaultMediaType: 'movie' },
]

const rowData = ref<Record<string, any[]>>({})
const rowLoading = ref<Record<string, boolean>>(
  Object.fromEntries(rows.map(r => [r.key, true])),
)

onMounted(() => {
  rows.forEach(async (row) => {
    try {
      const data = await $fetch<any>(row.endpoint, { params: row.params })
      const items = (data.results || [])
        .filter((r: any) => r.poster_path)
        .map((r: any) => ({
          ...r,
          _mediaType: r.media_type || row.defaultMediaType,
        }))
      rowData.value[row.key] = items
    } catch {
      rowData.value[row.key] = []
    } finally {
      rowLoading.value[row.key] = false
    }
  })
})

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
      <h1 class="page-title">Browse</h1>
    </div>

    <section v-for="row in rows" :key="row.key" class="row-section">
      <h2 class="row-title">{{ row.title }}</h2>

      <div v-if="rowLoading[row.key]" class="row-scroll">
        <div v-for="i in 8" :key="i" class="row-card">
          <div class="skeleton-poster" />
        </div>
      </div>

      <div v-else-if="rowData[row.key]?.length" class="row-scroll">
        <NuxtLink
          v-for="item in rowData[row.key]"
          :key="item.id"
          :to="`/${item._mediaType}/${item.id}`"
          class="row-card card"
        >
          <div class="card-poster">
            <img v-if="posterUrl(item.poster_path)" :src="posterUrl(item.poster_path)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
            </div>
          </div>
          <div class="row-card-title">{{ item.title || item.name }}</div>
          <div v-if="yearFrom(item.release_date || item.first_air_date)" class="row-card-meta">
            {{ yearFrom(item.release_date || item.first_air_date) }}
          </div>
        </NuxtLink>
      </div>

      <div v-else class="row-empty">
        <p>Nothing to show right now.</p>
      </div>
    </section>
  </div>
</template>
