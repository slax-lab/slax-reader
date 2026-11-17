import { cancelReaderRestore } from '~/utils/readerStartup'

export default defineNuxtPlugin({
  name: 'slax:reader-navigation',
  setup(nuxtApp) {
    const router = nuxtApp.$router
    router.beforeEach((to, from) => {
      const state = window.__slaxReaderStartup!
      const history = state.historyPath === to.path
      if (from.matched.length && to.path !== from.path) {
        state.start(to.fullPath, history)
      } else if (to.hash || to.query.highlight) {
        state.navigation.explicit = true
      }
      if (history || state.navigation.explicit) cancelReaderRestore()
      state.historyPath = null
    })
  }
})
