export async function useAgreementDocument(kind: 'terms' | 'privacy') {
  const route = useRoute()
  const { locale, t, loadLocaleMessages } = useI18n()
  const documentLocale = computed(() => {
    const hint = route.params.agreementLocale
    return hint === 'zh' || hint === 'en' ? hint : locale.value
  })
  const path = '/' + kind
  const result = useAsyncData(
    () => `agreement-${kind}-${documentLocale.value}`,
    async () => {
      const language = documentLocale.value
      if (language !== locale.value) await loadLocaleMessages(language)
      const content = await queryCollection(language === 'zh' ? 'open_docs_zh' : 'open_docs_en').path(path).first()
      const page = !content && language === 'zh' ? await queryCollection('open_docs_en').path(path).first() : content
      return { page, title: t('docs.title.' + kind, {}, { locale: language }) }
    }
  )
  useHead({ title: () => result.data.value?.title })
  await result
  return { page: computed(() => result.data.value?.page), documentLocale }
}
