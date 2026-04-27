<script setup lang="ts">
const props = defineProps<{
  link: string
  bytes: number
  filename: string
  title: string
  subtitle?: string
  tmdbId: number
  season?: number
  episode?: number
}>()
const emit = defineEmits<{ close: [] }>()

const { ensureAuth, clearAuth } = useAuth()
const { showToast } = useToast()

const checks = ref({ awake: false, tailscale: false, localUrl: false })
const preparing = ref(false)
const error = ref<string | null>(null)

const onVercel = ref(false)
onMounted(() => {
  // Heuristic: any *.vercel.app host is the deployed app, not the local server.
  onVercel.value = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')
})

const allChecked = computed(() => checks.value.awake && checks.value.tailscale && checks.value.localUrl)

function fmtSize(bytes: number) {
  if (!bytes) return ''
  const gb = bytes / 1_000_000_000
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  return `${(bytes / 1_000_000).toFixed(0)} MB`
}

function buildOutputName(): string {
  const base = props.filename.replace(/\.[a-z0-9]{2,4}$/i, '')
  return `${base}.mp4`
}

async function start() {
  if (!allChecked.value || preparing.value) return
  error.value = null
  preparing.value = true

  const secret = await ensureAuth()
  if (!secret) { preparing.value = false; return }

  try {
    const res = await $fetch<{ token: string }>('/api/download/prepare', {
      method: 'POST',
      headers: { 'X-App-Secret': secret },
      body: { link: props.link, filename: props.filename, bytes: props.bytes },
    })
    // Trigger download by clicking a hidden anchor with download attr.
    // Setting window.location is also possible but iOS Safari respects the
    // download attribute on <a> better.
    const a = document.createElement('a')
    a.href = `/api/download?token=${encodeURIComponent(res.token)}`
    a.download = buildOutputName()
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()

    showToast('Download started — check your browser', 'success')
    emit('close')
  } catch (err: any) {
    if (err.status === 401) {
      clearAuth()
      error.value = 'Invalid passphrase.'
    } else if (err.status === 503 || err.statusCode === 503) {
      error.value = err.data?.message || 'Downloads are only available when running kino locally on your MacBook.'
    } else {
      error.value = err.message || 'Failed to start download'
    }
  } finally {
    preparing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="dl-modal">
        <h2 class="modal-title">Before you download</h2>
        <p class="modal-subtitle">{{ title }}<span v-if="subtitle"> · {{ subtitle }}</span></p>

        <div v-if="onVercel" class="dl-banner">
          <strong>You're on the public Vercel URL.</strong>
          Downloads only work through your MacBook's Tailscale URL. Open kino on your MacBook's Tailscale address, then try again.
        </div>

        <div class="dl-checklist">
          <label class="dl-check">
            <input v-model="checks.awake" type="checkbox">
            <span>My MacBook is awake and running <code>npm run dev</code></span>
          </label>
          <label class="dl-check">
            <input v-model="checks.tailscale" type="checkbox">
            <span>My phone and MacBook are both signed into Tailscale</span>
          </label>
          <label class="dl-check">
            <input v-model="checks.localUrl" type="checkbox">
            <span>I'm visiting kino through my MacBook's Tailscale URL</span>
          </label>
        </div>

        <div class="dl-info">
          <div class="dl-info-row">
            <span>Format</span><span>MP4 (H.264 video, AAC audio, no subtitles)</span>
          </div>
          <div v-if="bytes" class="dl-info-row">
            <span>Approx size</span><span>{{ fmtSize(bytes) }}</span>
          </div>
        </div>

        <div v-if="error" class="dl-error">{{ error }}</div>

        <button
          class="modal-submit"
          :disabled="!allChecked || preparing"
          @click="start"
        >
          <template v-if="preparing">
            <div class="spinner" /> Preparing…
          </template>
          <template v-else>Continue download</template>
        </button>
        <button class="modal-cancel" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </Teleport>
</template>
