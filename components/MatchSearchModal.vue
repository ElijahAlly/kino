<script setup lang="ts">
import type { FileRef } from '~/composables/useLibrary'

const props = defineProps<{
  filename: string
  file: FileRef
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const { ensureAuth, clearAuth } = useAuth()
const { setOverride } = useLibrary()
const { showToast } = useToast()

const query = ref('')
const type = ref<'movie' | 'tv' | 'multi'>('multi')
const results = ref<Array<{ id: number; type: 'movie' | 'tv'; title: string; year: string; posterPath: string | null; overview?: string }>>([])
const loading = ref(false)

const seasonInput = ref('')
const episodeInput = ref('')
const selectedId = ref<number | null>(null)
const selectedType = ref<'movie' | 'tv' | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function debounceSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!query.value.trim()) { results.value = []; return }
  debounceTimer = setTimeout(doSearch, 300)
}

async function doSearch() {
  const secret = await ensureAuth()
  if (!secret) return
  loading.value = true
  try {
    const data = await $fetch<{ results: any[] }>('/api/library/match', {
      headers: { 'X-App-Secret': secret },
      params: { q: query.value, type: type.value },
    })
    results.value = data.results || []
  } catch (err: any) {
    if (err.status === 401) { clearAuth(); showToast('Invalid passphrase.', 'error') }
    else showToast('Search failed', 'error')
  } finally {
    loading.value = false
  }
}

function pick(r: { id: number; type: 'movie' | 'tv' }) {
  selectedId.value = r.id
  selectedType.value = r.type
}

function canSave(): boolean {
  if (selectedId.value == null || !selectedType.value) return false
  if (selectedType.value === 'tv') {
    return !!seasonInput.value.trim() && !!episodeInput.value.trim()
  }
  return true
}

function save() {
  if (!canSave()) return
  const ovr = selectedType.value === 'tv'
    ? {
        tmdbId: selectedId.value!,
        type: 'tv' as const,
        season: Number(seasonInput.value),
        episode: Number(episodeInput.value),
      }
    : { tmdbId: selectedId.value!, type: 'movie' as const }
  setOverride(props.file, ovr)
  showToast('Match saved — re-syncing', 'info')
  emit('saved')
}

function posterUrl(path: string | null) {
  return path ? `https://image.tmdb.org/t/p/w92${path}` : null
}

// Pre-populate with a guessed query from the filename
onMounted(() => {
  // Strip extension + tags, use first few words
  const base = props.filename.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ')
  query.value = base.split(/\s+/).slice(0, 4).join(' ')
  if (query.value.trim()) debounceSearch()
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="match-modal">
        <div class="match-header">
          <h2 class="modal-title">Find correct match</h2>
          <button class="match-close" aria-label="Close" @click="$emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div class="match-filename">{{ filename }}</div>

        <div class="match-controls">
          <input
            v-model="query"
            class="modal-input match-search-input"
            placeholder="Search TMDB…"
            autocomplete="off"
            @input="debounceSearch"
          >
          <div class="match-type-tabs">
            <button :class="{ active: type === 'multi' }" @click="type = 'multi'; debounceSearch()">Both</button>
            <button :class="{ active: type === 'movie' }" @click="type = 'movie'; debounceSearch()">Movie</button>
            <button :class="{ active: type === 'tv' }" @click="type = 'tv'; debounceSearch()">TV</button>
          </div>
        </div>

        <div v-if="loading" class="match-loading"><div class="spinner" /></div>
        <div v-else-if="!results.length && query" class="match-empty">No results.</div>

        <div class="match-results">
          <button
            v-for="r in results"
            :key="`${r.type}-${r.id}`"
            class="match-result"
            :class="{ selected: selectedId === r.id && selectedType === r.type }"
            @click="pick(r)"
          >
            <div class="match-poster">
              <img v-if="posterUrl(r.posterPath)" :src="posterUrl(r.posterPath)!" alt="" loading="lazy">
            </div>
            <div class="match-info">
              <div class="match-title">{{ r.title }}</div>
              <div class="match-meta">
                <span class="type-badge">{{ r.type === 'movie' ? 'Movie' : 'TV' }}</span>
                <span v-if="r.year">{{ r.year }}</span>
              </div>
              <div v-if="r.overview" class="match-overview">{{ r.overview }}</div>
            </div>
          </button>
        </div>

        <div v-if="selectedType === 'tv'" class="match-tv-fields">
          <input v-model="seasonInput" type="number" min="0" class="modal-input match-num-input" placeholder="Season">
          <input v-model="episodeInput" type="number" min="0" class="modal-input match-num-input" placeholder="Episode">
        </div>

        <button class="modal-submit" :disabled="!canSave()" @click="save">Save match</button>
        <button class="modal-cancel" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </Teleport>
</template>
