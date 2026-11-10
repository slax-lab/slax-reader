// LCP experiment switches. Enabled by default; add an environment restriction here
// (or a build-time constant in nuxt.config.ts's vite.define) if one is ever needed.
export default defineAppConfig({
  lcp: {
    articleImagePriority: true,
    anonymousPublicStartup: true
  }
})
