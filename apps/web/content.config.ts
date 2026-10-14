import { defineCollection, defineContentConfig } from '@nuxt/content'
import path from 'node:path'

export default defineContentConfig({
  collections: {
    open_docs_en: defineCollection({
      type: 'page',
      source: {
        cwd: path.resolve('./open_docs/en'),
        include: '*.md'
      }
    }),
    open_docs_zh: defineCollection({
      type: 'page',
      source: {
        cwd: path.resolve('./open_docs/zh'),
        include: '*.md'
      }
    }),
    docs_en: defineCollection({
      type: 'page',
      source: {
        cwd: path.resolve('./docs/en'),
        include: '*.md'
      }
    }),
    docs_zh: defineCollection({
      type: 'page',
      source: {
        cwd: path.resolve('./docs/zh'),
        include: '*.md'
      }
    })
  }
})
