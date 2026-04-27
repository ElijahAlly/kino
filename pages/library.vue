<script setup lang="ts">
const { library, removeFromLibrary } = useLibrary()
const { showToast } = useToast()

function handleRemove(tmdbId: number, title: string) {
  removeFromLibrary(tmdbId)
  showToast(`Removed ${title}`, 'info')
}

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null
}
</script>

<template>
  <div class="page-enter">
    <div class="page-header">
      <h1 class="page-title">Library</h1>
    </div>

    <div v-if="library.length" class="content-grid">
      <div v-for="item in library" :key="item.tmdbId" class="card-wrapper">
        <button class="card-remove" @click.stop="handleRemove(item.tmdbId, item.title)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <NuxtLink :to="`/${item.type}/${item.tmdbId}`" class="card">
          <div class="card-poster">
            <img v-if="posterUrl(item.posterPath)" :src="posterUrl(item.posterPath)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
            </div>
          </div>
          <div class="card-info">
            <div class="card-title">{{ item.title }}</div>
            <div class="card-meta">
              <span class="type-badge">{{ item.type === 'movie' ? 'Movie' : 'TV' }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>

    <div v-else class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      <p class="empty-title">Your library is empty</p>
      <p>Search for something to watch!</p>
    </div>
  </div>
</template>
