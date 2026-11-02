import { createApp, defineComponent, h, ref } from 'vue'

import BookmarkTags from '../../../app/components/BookmarkTags.vue'

import 'virtual:uno.css'
import '@unocss/reset/tailwind.css'
import '../../../styles/theme.tokens.css'
import '../../../styles/theme.css'
import { LocalFirstAdapterKey } from '../../../app/composables/local-first/injection'
import { imeGuard } from '../../../app/directives/imeGuard'
import { getI18nLang } from '../../../i18n/config'
import type { BookmarkTag } from '@commons/frontend-types/models'
import { createI18n } from 'vue-i18n'

const params = new URLSearchParams(location.search)
const surface = params.get('surface') || 'list'
const localOnly = surface === 'local-only'
const initial = { id: localOnly ? 'local-tag' : 1, name: 'tech', show_name: 'tech', source: 'mine', added_by: 'user' }
const app = createApp(defineComponent({
  setup() {
    const changes = ref(0)
    const tags = ref([initial] as BookmarkTag[])
    const readonly = ref(false)
    return () => h('main', { style: 'padding:32px;max-width:600px;margin:auto' }, [
      h('h1', { style: 'font-size:20px;margin-bottom:16px' }, `Synthetic ${surface} tag fallback`),
      h('p', { style: 'margin-bottom:24px' }, 'Local adapter present; both local writer factories return null.'),
      h(BookmarkTags, {
        tags: tags.value,
        bookmarkId: localOnly ? 0 : 7,
        bookmarkUid: params.has('uid') ? 'synthetic-bookmark-user' : '',
        bookmarkUuid: 'synthetic-detail-uuid',
        dataSource: localOnly ? 'local' : 'rest',
        compact: surface !== 'detail',
        variant: surface === 'detail' ? 'detail' : 'list-card',
        readonly: readonly.value,
        onChange: (updated: BookmarkTag[]) => { tags.value = updated; changes.value++ }
      }),
      h('p', { id: 'change-count', style: 'margin-top:24px' }, `Successful changes: ${changes.value}`),
      h('p', { id: 'feedback', role: 'status' }),
      h('button', { id: 'readonly', onClick: () => { readonly.value = !readonly.value } }, 'Toggle read-only')
    ])
  }
}))
app.use(createI18n({ legacy: false, locale: 'en', messages: getI18nLang() }))
app.directive('ime-guard', imeGuard)
app.provide(LocalFirstAdapterKey, { bookmarkTagSource: () => null, bookmarkTagActions: () => null })
app.mount('#app')
