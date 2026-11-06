import {useCallback, useEffect, useLayoutEffect, useMemo, useState} from 'react'
import {bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY} from '../../data'
import type {BookmarkRecord, TagRecord} from '../../data'
import {openInAppBrowser, shareArticle} from '../../native/platform'
import {jsonArray, jsonObject, subscriptionActive} from '../model'
import {readerShareImage} from '../share'
import {useVisibleSnapshot} from '../../components/useVisibleSnapshot'
import {httpOriginalUrl} from '../../utils/source-url'
import type {MobileContext, ReaderPresentationIdentity, ReaderScope, ReaderTelemetry} from './types'

interface BookmarkPorts {
  repositories: MobileContext['repositories']
  cache: MobileContext['cache']
  config: Pick<MobileContext['config'], 'platform' | 'webUrl'>
  fixtureOnly: boolean
  telemetry: ReaderTelemetry
  clearSelection(): void
  goBack(): void
}

export function useReaderBookmark(scope: ReaderScope, ports: BookmarkPorts) {
  const {cacheKey, bookmarkId, collectionOwnerId, collectionId, isCollection, isPreview, isAccountActive, mounted, reader, fail} = scope
  const {repositories, cache, config, fixtureOnly, telemetry, clearSelection, goBack} = ports
  const [record, setRecord] = useState<BookmarkRecord | null>(null)
  const [user, setUser] = useState<Record<string, unknown>>({})
  const [subscribed, setSubscribed] = useState(false)
  const [tags, setTags] = useVisibleSnapshot<TagRecord[]>(repositories, [], scope.routeVisible !== false && scope.appActive)
  const [collectionSettings, setCollectionSettings] = useState<{allow_highlight: boolean; show_highlight: boolean; allow_access: boolean} | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  useLayoutEffect(() => {setRecord(null); setCollectionSettings(null)}, [cacheKey])
  const metadata = useMemo(() => jsonObject(record?.metadata), [record?.metadata])
  const policy = useMemo(() => isPreview ? {...PENDING_COLLECTION_MARK_POLICY, isCollection: false} : isCollection ? record ? collectionMarkPolicy(metadata.share ? jsonObject(metadata.share) : null, collectionSettings ?? undefined) : PENDING_COLLECTION_MARK_POLICY : PERSONAL_MARK_POLICY, [isPreview, isCollection, record, metadata, collectionSettings])
  const selectedTagIds = useMemo(() => jsonArray<string>(metadata.tags), [metadata])
  const selectedTags = useMemo(() => tags.filter(tag => selectedTagIds.includes(tag.id)), [tags, selectedTagIds])

  useEffect(() => {
    if (!repositories || isPreview || !isAccountActive()) return
    let active = true
    const current = () => active && isAccountActive()
    const failure = (error: unknown) => {if (current()) fail(error)}
    const updateRecord = () => {
      if (isCollection && !collectionOwnerId) return
      void repositories.getBookmark(bookmarkId, collectionOwnerId).then(value => {if (current()) setRecord(value)}).catch(failure)
    }
    updateRecord()
    const unsubscribers = [
      repositories.watchUser(rows => {if (current()) setUser(rows[0] ?? {})}, failure),
      repositories.watchSubscription(rows => {if (current()) setSubscribed(subscriptionActive(rows))}, failure),
      repositories.watchTags(rows => {if (current()) setTags(rows)}, failure),
    ]
    if (bookmarkId && (!isCollection || collectionOwnerId)) {
      unsubscribers.push(repositories.watchRows(`SELECT * FROM ${isCollection ? 'sr_collection_bookmark' : 'sr_user_bookmark'} WHERE id = ?${isCollection ? ' AND owner_id = ?' : ''}`, [bookmarkId, ...(collectionOwnerId ? [collectionOwnerId] : [])], updateRecord, failure))
      if (collectionId) void repositories.markCollectionRead(collectionId).catch(failure)
    }
    if (collectionOwnerId) unsubscribers.push(repositories.watchCollectionSettings(collectionOwnerId, rows => {if (current()) setCollectionSettings(rows[0] ?? null)}, failure))
    return () => {active = false; unsubscribers.forEach(unsubscribe => unsubscribe())}
  }, [repositories, bookmarkId, collectionOwnerId, collectionId, isCollection, isPreview, isAccountActive, setTags])

  const acceptRecord = useCallback((value: BookmarkRecord) => setRecord(value), [])
  const toggle = (field: 'isStarred' | 'archiveStatus') => {
    if (!record || isCollection || !repositories || !isAccountActive()) return
    telemetry.element(field === 'isStarred' ? 'bookmark_star_button' : 'bookmark_archive_button', 'detail')
    telemetry.firebase('bookmark', field === 'isStarred' ? 'star' : 'archive', {source: 'detail', [field === 'isStarred' ? 'is_starred' : 'is_archived']: field === 'isStarred' ? record[field] ? 'unstar' : 'star' : record[field] ? 'unarchive' : 'archive'})
    clearSelection(); void repositories.updateBookmark(bookmarkId, {[field]: record[field] ? 0 : 1}).catch(fail)
  }
  const openOriginal = (originalUrl: string) => {
    if (!httpOriginalUrl(originalUrl) || !isAccountActive()) return
    if (fixtureOnly) {fail(new Error('External navigation is unavailable in controlled UI fixtures')); return}
    if (!isPreview) telemetry.firebase('bookmark', 'view', {}, 'original')
    void openInAppBrowser(originalUrl).catch(fail)
  }
  const share = async ({isPdf, title}: Pick<ReaderPresentationIdentity, 'isPdf' | 'title'>) => {
    if (!isAccountActive()) return
    if (fixtureOnly) throw new Error('Native sharing requires separate device acceptance outside controlled UI fixtures')
    const url = `${config.webUrl}/b/${encodeURIComponent(bookmarkId)}`
    const images = isPdf ? [] : await reader.current?.queryImageUrls().catch(() => []) ?? []
    const image = await readerShareImage(config.platform, images, cache, cacheKey, {allowNetwork: !fixtureOnly, isActive: isAccountActive})
    if (!mounted.current || !isAccountActive()) return
    await shareArticle(image, title, title.trim() ? `${title}\n${url}` : url, url)
    if (mounted.current && isAccountActive()) telemetry.firebase('bookmark', 'share')
  }
  const remove = async () => {
    if (isCollection || !repositories || !isAccountActive()) return
    try {await repositories.deleteBookmark(bookmarkId); if (mounted.current && isAccountActive()) {telemetry.firebase('bookmark', 'delete'); goBack()}}
    catch (error) {if (isAccountActive()) telemetry.firebase('bookmark', 'delete_failed'); throw error}
  }
  const saveTitle = async () => {
    if (!isCollection && isAccountActive()) await repositories?.updateBookmark(bookmarkId, {aliasTitle: draftTitle.replace(/\s+/g, ' ').trim()})
  }
  const updateTags = async (ids: string[]) => {
    if (!isCollection && isAccountActive()) await repositories?.updateTags(bookmarkId, ids)
    telemetry.firebase('bookmark', 'tag_update', {}, 'add')
  }
  const createTag = async (name: string) => {
    if (!repositories || isCollection || !isAccountActive()) throw new Error('Tag creation is not allowed')
    return repositories.createTag(name)
  }
  return {record, user, subscribed, tags, policy, selectedTagIds, selectedTags, draftTitle, setDraftTitle, acceptRecord, toggle, openOriginal, share, remove, saveTitle, updateTags, createTag}
}

export function readerPresentationIdentity(record: BookmarkRecord | null, input: Omit<ReaderPresentationIdentity, 'title' | 'originalUrl' | 'isPdf'> & {isPreview: boolean; routeTitle?: string; t: ReaderScope['t']}): ReaderPresentationIdentity {
  const {pdf, rss, isPreview, routeTitle, t} = input
  const isPdf = !isPreview && (record?.contentType === 'pdf' || pdf !== null)
  const pdfTitle = [record?.aliasTitle, record?.title, routeTitle].find(value => value?.trim() && value.trim() !== pdf?.filename && !/^(?:https?|slax-pdf):\/\//i.test(value.trim()))?.trim()
  const title = isPdf ? pdfTitle || t('pdf_reader') : record ? bookmarkDisplayTitle(record) : rss?.title || routeTitle || ''
  const sourceUrl = record?.url || rss?.article_url || ''
  const originalUrl = isPdf && pdf?.source !== 'url' ? '' : httpOriginalUrl(sourceUrl)
  return {title, originalUrl, isPdf, pdf, rss}
}
