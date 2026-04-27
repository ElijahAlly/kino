<script setup lang="ts">
const route = useRoute()
const { toasts } = useToast()
const { showModal, submitAuth, cancelAuth } = useAuth()

const authInput = ref('')
const authInputRef = ref<HTMLInputElement | null>(null)

const tabs = [
  { name: 'Search', path: '/', icon: 'search' },
  { name: 'Trending', path: '/trending', icon: 'fire' },
  { name: 'Library', path: '/library', icon: 'bookmark' },
]

function isActiveTab(tabPath: string) {
  if (tabPath === '/') return route.path === '/'
  return route.path.startsWith(tabPath)
}

function handleAuthSubmit() {
  const val = authInput.value.trim()
  if (!val) return
  submitAuth(val)
  authInput.value = ''
}

watch(showModal, (val) => {
  if (val) nextTick(() => authInputRef.value?.focus())
})
</script>

<template>
  <div class="kino-main">
    <NuxtPage />
  </div>

  <nav class="bottom-nav">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      class="nav-tab"
      :class="{ active: isActiveTab(tab.path) }"
    >
      <svg v-if="tab.icon === 'search'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <svg v-else-if="tab.icon === 'fire'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10c0 3.5-2 5-5 7-3-2-5-3.5-5-7a5 5 0 0 1 1.5-3.5C9.5 5.5 11 5 12 2z" />
      </svg>
      <svg v-else-if="tab.icon === 'bookmark'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      <span class="nav-label">{{ tab.name }}</span>
    </NuxtLink>
  </nav>

  <Teleport to="body">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
        {{ toast.message }}
      </div>
    </TransitionGroup>
  </Teleport>

  <Teleport to="body">
    <Transition name="modal">
      <div v-if="showModal" class="modal-overlay" @click.self="cancelAuth">
        <div class="modal-card">
          <h2 class="modal-title">Welcome to Kino</h2>
          <p class="modal-subtitle">Enter your passphrase to continue</p>
          <input
            ref="authInputRef"
            v-model="authInput"
            type="password"
            class="modal-input"
            placeholder="Passphrase"
            autocomplete="off"
            @keydown.enter="handleAuthSubmit"
          >
          <button class="modal-submit" @click="handleAuthSubmit">Continue</button>
          <button class="modal-cancel" @click="cancelAuth">Cancel</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
