import { createApp, h } from 'vue'
import EmailLoginPage from '../../../app/pages/email-login.vue'
import { fixtureI18n } from './runtime'
import '@unocss/reset/tailwind.css'
import '../../../styles/theme.tokens.css'
import '../../../styles/theme.css'

createApp({ render: () => h(EmailLoginPage) }).use(fixtureI18n).mount('#app')
