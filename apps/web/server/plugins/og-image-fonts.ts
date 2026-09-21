export default defineNitroPlugin(nitroApp => {
  //@ts-ignore
  nitroApp.hooks.hook('nuxt-og-image:context', ctx => {
    const existingFonts = Array.isArray(ctx.options.fonts) ? ctx.options.fonts : []
    ctx.options.fonts = [
      ...existingFonts,
      {
        name: 'Noto Sans SC',
        path: '/fonts/noto-sans-sc-400.ttf',
        weight: 400,
        style: 'normal'
      }
    ]
    console.log('[og-image-fonts] injected Noto Sans SC, total fonts:', ctx.options.fonts.length)
  })
})
