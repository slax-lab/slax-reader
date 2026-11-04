export default defineNuxtRouteMiddleware((to, from) => {
  const navigation = useSnapshotSessionNavigation()
  navigation.value = to.path !== from.path && /^\/b\/[^/]+\/?$/.test(to.path) ? to.path : null
})
