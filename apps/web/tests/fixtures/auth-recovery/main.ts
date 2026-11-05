import { createApp, h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'

import AuthPage from '../../../app/pages/auth.vue'

import 'virtual:uno.css'
import '@unocss/reset/tailwind.css'
import '../../../styles/theme.tokens.css'
import '../../../styles/theme.css'
import { fixtureI18n } from './runtime'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.slaxTheme = params.get('theme') || 'light'
document.documentElement.lang = params.get('locale') || 'en'
const router = createRouter({ history: createWebHistory(), routes: [{ path: '/auth', component: AuthPage }] })
const app = createApp({ render: () => h(AuthPage) })
app.use(fixtureI18n)
app.use(router)
await router.isReady()
app.mount('#app')
