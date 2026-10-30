// LCP experiment switches: values come from nuxt.config.ts's vite.define and are
// build-time constants. Disabled for production/beta, enabled for preview/local dev;
// change nuxt.config.ts to enable in production once the gates pass.
export default defineAppConfig({
  lcp: {
    articleImagePriority: __SLAX_LCP_ARTICLE_IMAGE_PRIORITY__,
    anonymousPublicStartup: __SLAX_LCP_ANONYMOUS_PUBLIC_STARTUP__
  }
})
