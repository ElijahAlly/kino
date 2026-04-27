<script setup lang="ts">
const { library, syncing, syncNow } = useLibrary()
const { progress } = useResume()

// Auto-resync in background on first mount each session if the cache is older
// than 30 minutes (or empty). User-initiated syncs always run regardless.
onMounted(() => {
  const stale = Date.now() - library.value.syncedAt > 30 * 60 * 1000
  if (stale) syncNow({ silent: false })
})

const showFixModal = ref(false)
const fixTarget = ref<{ filename: string; file: any } | null>(null)

function openFixMatch(item: { filename: string; file: any }) {
  fixTarget.value = item
  showFixModal.value = true
}

function closeFixMatch() {
  showFixModal.value = false
  fixTarget.value = null
}

function onMatchSaved() {
  closeFixMatch()
  syncNow({ silent: false })
}

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null
}

function syncedLabel(ts: number): string {
  if (!ts) return 'Never synced'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

function showLink(tmdbId: number) {
  return `/play/tv/${tmdbId}`
}

function movieLink(tmdbId: number) {
  return `/play/movie/${tmdbId}`
}
</script>

<template>
  <div class="page-enter">
    <div class="library-header">
      <div>
        <h1 class="page-title">Library</h1>
        <div class="library-sync-status">{{ syncing ? 'Syncing…' : `Last synced: ${syncedLabel(library.syncedAt)}` }}</div>
      </div>
      <button
        class="sync-btn"
        :class="{ loading: syncing }"
        :disabled="syncing"
        :aria-label="syncing ? 'Syncing' : 'Sync library'"
        @click="syncNow()"
      >
        <svg v-if="!syncing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        <div v-else class="spinner" />
      </button>
    </div>

    <!-- Movies -->
    <section v-if="library.movies.length" class="lib-section">
      <h2 class="lib-section-title">Movies <span class="lib-count">{{ library.movies.length }}</span></h2>
      <div class="content-grid">
        <NuxtLink
          v-for="m in library.movies"
          :key="m.tmdbId"
          :to="movieLink(m.tmdbId)"
          class="card"
        >
          <div class="card-poster">
            <img v-if="posterUrl(m.posterPath)" :src="posterUrl(m.posterPath)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
            </div>
            <div v-if="progress(m.tmdbId) > 0.02" class="resume-bar">
              <div class="resume-bar-fill" :style="{ width: `${progress(m.tmdbId) * 100}%` }" />
            </div>
          </div>
          <div class="card-info">
            <div class="card-title">{{ m.title }}</div>
            <div class="card-meta">
              <span v-if="m.year">{{ m.year }}</span>
              <span v-if="m.runtime">{{ m.runtime }}m</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- TV Shows -->
    <section v-if="library.tv.length" class="lib-section">
      <h2 class="lib-section-title">TV Shows <span class="lib-count">{{ library.tv.length }}</span></h2>
      <div class="content-grid">
        <NuxtLink
          v-for="s in library.tv"
          :key="s.tmdbId"
          :to="showLink(s.tmdbId)"
          class="card"
        >
          <div class="card-poster">
            <img v-if="posterUrl(s.posterPath)" :src="posterUrl(s.posterPath)!" alt="" loading="lazy">
            <div v-else class="card-poster-fallback">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /></svg>
            </div>
          </div>
          <div class="card-info">
            <div class="card-title">{{ s.title }}</div>
            <div class="card-meta">
              <span>{{ s.episodes.length }} ep{{ s.episodes.length === 1 ? '' : 's' }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Unmatched -->
    <section v-if="library.unmatched.length" class="lib-section">
      <h2 class="lib-section-title">Unmatched <span class="lib-count">{{ library.unmatched.length }}</span></h2>
      <div class="unmatched-list">
        <div v-for="u in library.unmatched" :key="`${u.file.torrentId}:${u.file.fileId}`" class="unmatched-row">
          <div class="unmatched-info">
            <div class="unmatched-name">{{ u.filename }}</div>
            <div class="unmatched-meta">
              <span v-if="u.parsed.title">guessed: {{ u.parsed.title }}</span>
              <span v-if="u.parsed.year"> · {{ u.parsed.year }}</span>
            </div>
          </div>
          <button class="match-btn" @click="openFixMatch(u)">Search TMDB</button>
        </div>
      </div>
    </section>

    <!-- Empty -->
    <div v-if="!library.movies.length && !library.tv.length && !library.unmatched.length && !syncing" class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      <p class="empty-title">Your library is empty</p>
      <p>Add titles from Search or Trending — they'll show up here after syncing.</p>
    </div>

    <MatchSearchModal
      v-if="showFixModal && fixTarget"
      :filename="fixTarget.filename"
      :file="fixTarget.file"
      @saved="onMatchSaved"
      @close="closeFixMatch"
    />
  </div>
</template>
