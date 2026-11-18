<template>
  <div>
    <BookmarksTopBar @search="searchBookmarks" @feedback="feedback" />
    <main class="plaza">
      <header class="masthead">
        <div>
          <h1>{{ $t('page.user.labs.discovery.name') }}</h1>
          <p v-if="state === 'ready' && (collections.length || singlePicks.length)" class="masthead-deck">{{ $t('page.discovery.personalized') }}</p>
        </div>
        <a v-if="collections.length && singlePicks.length" class="jump" href="#single-picks">
          {{ $t('page.discovery.singles') }} <span aria-hidden="true">↓</span>
        </a>
      </header>

      <template v-if="state === 'ready' && (collections.length || singlePicks.length)">
        <section v-if="featured.length" class="topic-section" aria-labelledby="topic-heading">
          <div class="topic-heading">
            <h2 id="topic-heading" aria-live="polite">{{ activeTopic ? $t('page.discovery.topics.' + activeTopic.key) : $t('page.discovery.forYou') }}</h2>
            <details v-if="topics.length" class="topic-picker">
              <summary>{{ $t('page.discovery.exploreTopics') }}</summary>
              <div class="topic-nav" role="group" :aria-label="$t('page.discovery.exploreTopics')">
                <button type="button" :aria-pressed="!activeTopic" @click="selectTopic('')">{{ $t('page.discovery.forYou') }}</button>
                <button v-for="topic in topics" :key="topic.key" type="button" :aria-pressed="activeTopic?.key === topic.key" @click="selectTopic(topic.key)">
                  {{ $t('page.discovery.topics.' + topic.key) }}
                </button>
              </div>
            </details>
          </div>
          <div v-if="activeTopic" class="topic-context">
            <p>{{ $t('page.discovery.topicEvidence', { count: activeTopic.matches.length }) }}</p>
            <button v-if="activeTopic.matches.length > 2" type="button" class="rotate" @click="nextPair">{{ $t('page.discovery.nextPair') }} →</button>
          </div>
          <div class="spotlights">
            <article v-for="{ collection, lead } in featured" :key="collection.code" class="spotlight">
              <DiscoveryMasthead class="spot-collection" :href="collectionLink(collection)" :name="collection.name || $t('page.discovery.untitled')" />
              <h3><a class="lead-link" :href="articleLink(lead)">{{ lead.title || lead.url }}</a></h3>
              <p v-if="lead.description" class="lead-excerpt">{{ lead.description }}</p>
              <p class="lead-source">
                <strong>{{ publication(lead) }}</strong><span v-if="interestLabel(lead)">{{ interestLabel(lead) }}</span>
              </p>
              <ul class="related">
                <li v-for="article in collection.articles.filter(item => item.bookmarkUuid !== lead.bookmarkUuid).slice(0, 2)" :key="article.bookmarkUuid">
                  <a :href="articleLink(article)"><span class="related-title">{{ article.title || article.url }}</span><span v-if="publication(article)" class="related-source">{{ publication(article) }}</span></a>
                </li>
              </ul>
            </article>
          </div>
        </section>
        <section v-if="remainingCollections.length" aria-labelledby="recommended-heading">
          <div class="section-heading">
            <div>
              <h2 id="recommended-heading">{{ $t('page.discovery.moreCollections') }}</h2>
            </div>
            <span class="count">{{ $t('page.discovery.totals', { collections: remainingCollections.length, articles: groupedArticleCount }) }}</span>
          </div>
          <div class="feed">
            <article v-for="collection in remainingCollections" :key="collection.code" class="collection-card">
              <header>
                <DiscoveryMasthead :description="collection.description" class="collection-link" :href="collectionLink(collection)" :name="collection.name || $t('page.discovery.untitled')" />
              </header>
              <ul class="members">
                <li v-for="(article, index) in collection.articles.slice(0, 3)" :key="article.bookmarkUuid">
                  <a class="article-link" :href="articleLink(article)">
                    <span class="article-title">{{ article.title || article.url }}</span>
                    <span v-if="index === 0 && article.description" class="excerpt">{{ article.description }}</span>
                    <span class="source">{{ publication(article) }}<template v-if="interestLabel(article)"> · {{ interestLabel(article) }}</template></span>
                  </a>
                </li>
              </ul>
            </article>
          </div>
        </section>

        <section v-if="singlePicks.length" id="single-picks" aria-labelledby="singles-heading">
          <div class="section-heading">
            <div>
              <h2 id="singles-heading">{{ $t('page.discovery.singles') }}</h2>
              <p>{{ $t('page.discovery.singlesHint') }}</p>
            </div>
          </div>
          <ul class="singles">
            <li v-for="{ article, collection } in singlePicks" :key="collection.code">
              <a class="single-source" :href="collectionLink(collection)">{{ collection.name || $t('page.discovery.untitled') }}</a>
              <a class="article-link" :href="articleLink(article)">
                <span class="article-title">{{ article.title || article.url }}</span>
                <span class="source">{{ publication(article) }}<template v-if="interestLabel(article)"> · {{ interestLabel(article) }}</template></span>
              </a>
            </li>
          </ul>
        </section>
      </template>

      <div v-else class="status" :role="state === 'error' ? 'alert' : 'status'">
        <h2>{{ $t('page.discovery.' + statusKey) }}</h2>
        <p v-if="statusKey === 'cold'">{{ $t('page.discovery.coldHint') }}</p>
        <NuxtLink v-if="state === 'disabled'" to="/user#labs">{{ $t('page.discovery.settings') }} ↗</NuxtLink>
        <NuxtLink v-else-if="statusKey === 'cold'" to="/bookmarks?filter=collections">{{ $t('page.discovery.myCollections') }} ↗</NuxtLink>
        <button v-else-if="state === 'error'" type="button" @click="load">{{ $t('page.discovery.retry') }}</button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'
import DiscoveryMasthead from '~/components/DiscoveryMasthead.vue'
import BookmarksTopBar from '~/components/BookmarkList/BookmarksTopBar.vue'

import { discoveryTopics } from '~/utils/discoveryTopics'

import { type CollectionRecommendations, DISCOVERY_MEDIA_TYPE, type RecommendedCollection } from '@slax-reader/contracts/collections'
import { showFeedbackModal } from '~/components/Modal'

type Article = RecommendedCollection['articles'][number]

const { t } = useI18n()
const labs = useLabFeatures()
const user = useUserStore()
useHead({ title: () => t('page.user.labs.discovery.name') })

const state = ref<'loading' | 'ready' | 'disabled' | 'error'>('loading')
const result = shallowRef<CollectionRecommendations>()
const collections = computed(() => result.value?.items.filter(collection => collection.articles.length >= 2) ?? [])
const singlePicks = computed(() => (result.value?.items ?? []).flatMap(collection =>
  collection.articles.length === 1 ? [{ collection, article: collection.articles[0]! }] : []
))
const topics = computed(() => discoveryTopics(collections.value))
const selectedKey = ref('')
const offset = ref(0)
const activeTopic = computed(() => topics.value.find(topic => topic.key === selectedKey.value))
const featured = computed(() => {
  if (!activeTopic.value) return collections.value.slice(0, 2).map(collection => ({ collection, lead: collection.articles[0]! }))
  const matches = activeTopic.value.matches
  return [matches[offset.value % matches.length]!, matches[(offset.value + 1) % matches.length]!]
})
const remainingCollections = computed(() => {
  const featuredCodes = new Set(featured.value.map(match => match.collection.code))
  return collections.value.filter(collection => !featuredCodes.has(collection.code))
})
function selectTopic(key: string) {
  selectedKey.value = key
  offset.value = 0
}
function nextPair() {
  if (activeTopic.value) offset.value = (offset.value + 2) % activeTopic.value.matches.length
}
const groupedArticleCount = computed(() => remainingCollections.value.reduce((sum, collection) => sum + Math.min(3, collection.articles.length), 0))
const statusKey = computed(() => {
  if (state.value !== 'ready') return state.value
  return result.value?.reason === 'cold_start' ? 'cold' : 'empty'
})

async function load() {
  state.value = 'loading'
  try {
    await labs.fetch(true)
    if (!labs.isEnabled('discovery')) {
      state.value = 'disabled'
      return
    }
    const response = await request().get<CollectionRecommendations>({
      url: '/v1/recommendations/collections',
      query: { limit: 36 },
      headers: { Accept: DISCOVERY_MEDIA_TYPE }
    })
    if (!response || !Array.isArray(response.items)) throw new Error('Missing Collection recommendations')
    result.value = response
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}
onMounted(load)

function interestLabel(article: Article) {
  if (article.selectionReason === 'saved_interest') return t('page.discovery.savedInterest')
  return article.selectionReason === 'interest' ? t('page.discovery.interest') : ''
}

function articleLink(article: Article) {
  return '/b/' + encodeURIComponent(article.bookmarkUuid)
}
function collectionLink(collection: RecommendedCollection) {
  return '/c/' + encodeURIComponent(collection.code)
}
function publication(article: Article) {
  if (article.siteName?.trim()) return article.siteName.trim()
  try {
    return new URL(article.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
function searchBookmarks(keyword: string) {
  if (keyword) navigateTo({ path: '/bookmarks', query: { q: keyword } })
}
function feedback() {
  showFeedbackModal({ title: '', reportType: 'parse_error', email: user.userInfo?.email || '', params: { entry_point: 'discovery' } })
}
</script>

<style scoped>
.plaza {
  max-width: var(--slax-shell-w);
  margin-inline: auto;
  padding: calc(var(--slax-header-height) + 24px) 32px 64px;
  color: var(--slax-text);
  overflow-wrap: anywhere;
}
.masthead, .section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.masthead {
  padding-bottom: 15px;
  border-bottom: 1px solid var(--slax-border-strong);
}
.masthead h1, .section-heading h2 {
  font-family: var(--slax-font-serif);
}
.masthead h1 {
  font-size: clamp(36px, 5vw, 64px);
  font-weight: 700;
  letter-spacing: -.045em;
  line-height: 1.18;
}
.plaza a { color: inherit; text-decoration: none; }
.plaza .jump { font-size: var(--slax-fs-meta); color: var(--slax-text-muted); padding-block: 8px; }
.topic-picker { position: relative; }
.topic-picker summary { cursor: pointer; padding: 6px; color: var(--slax-text-muted); font-size: var(--slax-fs-meta); }
.topic-nav { display: flex; flex-wrap: wrap; gap: 6px; position: absolute; z-index: 2; inset-inline-end: 0; width: min(320px, 86vw); padding: 12px; background: var(--slax-surface-solid); border: 1px solid var(--slax-border-strong); }
.topic-context { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }

.topic-nav button, .rotate {
  flex: none; border: 1px solid var(--slax-border-strong); border-radius: 999px;
  padding: 5px 13px; font-size: var(--slax-fs-aux); color: var(--slax-text); background: var(--slax-bg); cursor: pointer;
}
.topic-nav button[aria-pressed=true] { background: var(--slax-text); color: var(--slax-bg); border-color: var(--slax-text); }
.topic-nav button:hover, .rotate:hover { border-color: var(--slax-accent); }
.topic-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin: 17px 0 12px; }
.topic-heading h2 { color: var(--slax-text); font: 650 var(--slax-fs-meta)/1.45 var(--slax-font-sans); }
.topic-heading p, .lead-source { color: var(--slax-text-muted); font-size: var(--slax-fs-aux); margin-top: 5px; }
.rotate { padding: 6px 10px; }
.spotlights { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; padding-top: 14px; border-top: 1px solid var(--slax-text); }
.spotlight { display: flex; flex-direction: column; align-items: start; padding: 16px 20px 8px; }
.spotlight:first-child { background: var(--slax-discovery-cover); color: var(--slax-discovery-cover-text); border: 1px solid currentColor; border-radius: 4px; padding: clamp(16px, 2vw, 26px); }
.spotlight:first-child h3 { font-size: clamp(28px, 3.1vw, 40px); }
.spotlight:first-child :is(.lead-source, .spot-collection) { color: inherit; }
.spotlight:first-child .related li { border-color: color-mix(in srgb, currentColor 32%, transparent); }
.spotlight + .spotlight { border-block: 3px double var(--slax-text); padding-inline: 4px; }
.spot-collection { padding-bottom: 14px; border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
.spotlight h3 { margin-top: 12px; font: 650 clamp(20px, 2.2vw, 29px)/1.32 var(--slax-font-serif); }
.spotlight a:hover { text-decoration: underline; text-underline-offset: 3px; }
.lead-excerpt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 6px; font-size: var(--slax-fs-aux); }
.lead-source { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin-block: 8px 16px; }
.lead-source strong { font-weight: 650; }
.lead-source span { padding-inline-start: 10px; border-inline-start: 1px solid currentColor; }
.related-source { flex: none; max-width: 37%; overflow-wrap: anywhere; text-align: end; font-size: var(--slax-fs-tag); }

.related { list-style: none; width: 100%; padding: 0; margin: auto 0 0; }
.related li { border-top: 1px solid var(--slax-border-strong); }
.related a { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 7px 0; font-size: var(--slax-fs-aux); }
.related-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.section-heading {
  margin: 23px 0 16px;
  align-items: end;
}
.section-heading h2 {
  color: var(--slax-accent);
  font-size: clamp(22px, 2.2vw, 28px);
  font-weight: 700;
  line-height: 1.25;
}
.section-heading p, .count {
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  line-height: 1.5;
}
.section-heading p { margin-top: 4px; }
.count { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.feed, .singles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.collection-card {
  min-width: 0;
  border-top: 1px solid var(--slax-border-strong);
}
.collection-link { justify-content: flex-start; padding: 14px 0 6px; min-height: 44px; }
.masthead-deck { margin-top: 6px; font-size: var(--slax-fs-meta); color: var(--slax-text-muted); }
.members, .singles { list-style: none; margin: 0; }
.members { padding: 0; }
.members li:first-child .article-title { font: 650 var(--slax-fs-card)/1.4 var(--slax-font-serif); }
.members li + li { border-top: 1px solid var(--slax-border); }
.article-link { display: grid; gap: 3px; padding-block: 10px; }
.article-title {
  font-size: var(--slax-fs-body);
  font-weight: 500;
  line-height: 1.42;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.excerpt {
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source { color: var(--slax-text-muted); font-size: var(--slax-fs-tag); line-height: 1.4; }
.article-link:hover .article-title, .jump:hover, .single-source:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.article-link:hover .article-title { color: var(--slax-accent); }
.plaza :is(a, button, summary):focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
#single-picks { scroll-margin-top: calc(var(--slax-header-height) + 12px); }
#single-picks .section-heading { margin-top: 34px; }
.singles { padding: 0; gap: 0 24px; }
.singles li { padding-block: 12px; border-top: 1px solid var(--slax-border-strong); }
.singles .article-link { padding-block: 4px; }
.plaza .single-source { color: var(--slax-accent); font-size: var(--slax-fs-aux); }
.status { padding: 32px 0; }
.status h2 { font-size: var(--slax-fs-h2); }
.status p { margin-top: 10px; color: var(--slax-text-muted); }
.status :is(a,button) { display: inline-block; margin-top: 14px; text-decoration: underline; color: var(--slax-accent); }
@media (max-width: 768px) {
  .plaza {
    padding: calc(var(--slax-header-height) + 14px) max(16px, env(safe-area-inset-right)) 44px max(16px, env(safe-area-inset-left));
  }
  .feed, .singles, .spotlights { grid-template-columns: 1fr; }
  .spotlight { padding: 13px 14px 7px; }
  .spotlights { gap: 14px; }
  .topic-heading { margin-block: 12px 9px; }
  .feed { gap: 14px; }
  .collection-link { padding-block: 10px 4px; }
  .section-heading { flex-wrap: wrap; gap: 4px 12px; margin: 16px 0 12px; }
}
</style>
