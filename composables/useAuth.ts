let _resolveAuth: ((val: string | null) => void) | null = null

export function useAuth() {
  const appSecret = useState<string>('auth-secret', () => {
    return localStorage.getItem('kino-secret') || ''
  })
  const showModal = useState('auth-modal', () => false)

  async function ensureAuth(): Promise<string | null> {
    if (appSecret.value) return appSecret.value
    showModal.value = true
    return new Promise(resolve => { _resolveAuth = resolve })
  }

  function submitAuth(secret: string) {
    appSecret.value = secret
    localStorage.setItem('kino-secret', secret)
    showModal.value = false
    _resolveAuth?.(secret)
    _resolveAuth = null
  }

  function cancelAuth() {
    showModal.value = false
    _resolveAuth?.(null)
    _resolveAuth = null
  }

  function clearAuth() {
    appSecret.value = ''
    localStorage.removeItem('kino-secret')
  }

  return { appSecret, showModal, ensureAuth, submitAuth, cancelAuth, clearAuth }
}
