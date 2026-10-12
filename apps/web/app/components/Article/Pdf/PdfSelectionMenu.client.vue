<template>
  <div ref="host" :inert="saving" :aria-busy="saving" />
</template>

<script setup lang="ts">
import { defineCustomElement } from 'vue'
import ArticleSelectionMenus from '../Selection/ArticleSelectionMenus.ce.vue'
import type { MenuType } from '../Selection/type'

const props = defineProps<{ allowAction: boolean; allowChatbot: boolean; isStroked: boolean; saving: boolean }>()
const emit = defineEmits<{ action: [type: MenuType, event: MouseEvent]; dismiss: []; resize: [] }>()
const host = ref<HTMLDivElement>()
let observer: ResizeObserver | undefined

// Reuse the article menu unchanged; responsive overrides apply only to this PDF host.
const PdfMenuElement = defineCustomElement(ArticleSelectionMenus, {
  styles: [
    ...((ArticleSelectionMenus as typeof ArticleSelectionMenus & { styles?: string[] }).styles ?? []),
    `:host { display: block; font-family: var(--slax-font-sans); }
     .article-selection-menus { box-sizing: border-box; max-width: calc(100vw - 24px); }
     .menu:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: -2px; }
     @media (max-width: 768px) {
       .article-selection-menus { flex-wrap: wrap; }
       .article-selection-menus .menu { min-height: 44px; min-width: 44px; padding: 6px 8px; }
     }
     @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
     :host-context([data-slax-theme='eink']) .article-selection-menus { box-shadow: none; }
     :host-context([data-slax-theme='eink']) * { transition: none !important; }`
  ]
})
let menu: InstanceType<typeof PdfMenuElement> | undefined
onMounted(() => {
  if (!customElements.get('slax-pdf-selection-menu')) customElements.define('slax-pdf-selection-menu', PdfMenuElement)
  const Constructor = customElements.get('slax-pdf-selection-menu') as typeof PdfMenuElement
  menu = new Constructor({ allowAction: props.allowAction, allowChatbot: props.allowChatbot, isStroked: props.isStroked })
  menu.addEventListener('action', event => {
    const [type, mouse] = (event as CustomEvent<[MenuType, MouseEvent]>).detail
    emit('action', type, mouse)
  })
  menu.addEventListener('noAction', () => emit('dismiss'))
  menu.addEventListener('dismiss', () => emit('dismiss'))
  host.value?.appendChild(menu)
  observer = new ResizeObserver(() => emit('resize'))
  if (host.value) observer.observe(host.value)
})
watch(() => [props.allowAction, props.allowChatbot, props.isStroked], () => {
  if (menu) Object.assign(menu, { allowAction: props.allowAction, allowChatbot: props.allowChatbot, isStroked: props.isStroked })
})
onBeforeUnmount(() => { observer?.disconnect(); menu?.remove() })
</script>
