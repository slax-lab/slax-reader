import { onMounted, onUnmounted, ref } from 'vue'

import { configuredCookieName, readStringCookie } from '~/utils/authCookie'
import { finishSnapshotEmail } from '~/utils/bookmarkFork'
import { emailAuthErrorKey } from '~/utils/emailAuth'
import { takeEmailLoginProof } from '~/utils/emailLinkAuth'

import { useCookies } from '@vueuse/integrations/useCookies'

export function useEmailLinkLogin() {
  const auth = useAuth()
  const cookies = useCookies()
  const cookieName = configuredCookieName(useRuntimeConfig().public.COOKIE_TOKEN_NAME)
  const status = ref<'loading' | 'signed-in' | 'failed'>('loading')
  const message = ref('email_auth.sign_in_link_failed')
  const controller = new AbortController()
  let deadline: ReturnType<typeof setTimeout> | undefined
  onUnmounted(() => { clearTimeout(deadline); controller.abort() })
  onMounted(async () => {
    const proof = takeEmailLoginProof()
    if (readStringCookie(cookieName, cookies)) { status.value = 'signed-in'; return }
    if (!proof) { status.value = 'failed'; return }
    deadline = setTimeout(() => { status.value = 'failed'; controller.abort() }, 20_000)
    try {
      const token = await auth.verifyEmailLinkAuth(proof, { signal: controller.signal, errorInterceptors: () => false })
      if (!controller.signal.aborted) {
        clearTimeout(deadline)
        const target = await finishSnapshotEmail(proof.request_id, token, controller.signal)
        if (target === '/bookmarks') await navigateTo('/bookmarks')
        else await navigateTo(target, { external: true })
      }
    } catch (error) {
      if (controller.signal.aborted) return
      if (readStringCookie(cookieName, cookies)) { status.value = 'signed-in'; return }
      if (emailAuthErrorKey(error, 'sign_in_link_failed') === 'email_auth.use_existing_login') message.value = 'email_auth.use_existing_login'
      status.value = 'failed'
    } finally { clearTimeout(deadline) }
  })
  return { status, message }
}
