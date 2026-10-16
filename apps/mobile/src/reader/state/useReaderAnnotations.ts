import {useCallback, useEffect, useLayoutEffect, useMemo, useState} from 'react'
import type {RefObject} from 'react'
import * as Clipboard from 'expo-clipboard'
import {validatePdfSources, type PdfDescriptor} from '@slax-reader/contracts/pdf'
import type {MarkCommentProfile, MarkRecord, PERSONAL_MARK_POLICY} from '../../data'
import {buildReaderMarks, jsonObject, refreshSelectedMark, selectionForMark, selectionPaths, sourceStableId, sourceStrokeToRemove} from '../model'
import type {ReaderComment, ReaderEvent, ReaderMarkItem, ReaderSelection} from '../types'
import type {MobileContext, ReaderScope} from './types'
import {FeatureState} from './feature-state'

interface AnnotationPorts {
  repositories: Pick<NonNullable<MobileContext['repositories']>, 'watchComments' | 'addMark' | 'deleteMark' | 'local'> | null
  api: Pick<MobileContext['api'], 'getMarkUsers'>
  policy: typeof PERSONAL_MARK_POLICY
  user: Record<string, unknown>
  documentReady: boolean
  isPdf: boolean
  pdfSnapshot: RefObject<PdfDescriptor | null>
}
export function useReaderAnnotations(scope: ReaderScope, ports: AnnotationPorts) {
  const {cacheKey, bookmarkId, collectionOwnerId, isCollection, isPreview, currentUserId, isAccountActive, foreground, mounted, appActive, reader, fail, t} = scope
  const {repositories, api, policy, user, documentReady, isPdf, pdfSnapshot} = ports
  const stableUserId = sourceStableId(currentUserId)
  const [marks, setMarks] = useState<MarkRecord[]>([]), [markProfiles, setMarkProfiles] = useState<MarkCommentProfile[]>([])
  const [selection, setSelection] = useState<{mark: ReaderMarkItem; text: string; y: number} | null>(null)
  const [panel, setPanel] = useState<{mark: ReaderMarkItem; text: string; autoFocus: boolean; captured?: ReaderSelection} | null>(null)
  const draftState = useMemo(() => new FeatureState(''), [cacheKey, isAccountActive])
  const setDraft = draftState.set
  const [reply, setReply] = useState<ReaderComment | null>(null)
  const [markBusy, setMarkBusy] = useState(false), [discard, setDiscard] = useState<'panel' | null>(null)
  const [deletingComment, setDeletingComment] = useState<ReaderComment | null>(null)
  const [commentMenu, setCommentMenu] = useState<{markId: number; x: number; y: number} | null>(null)
  const [copied, setCopied] = useState(false), [pdfMarkInfos, setPdfMarkInfos] = useState<ReaderMarkItem[]>([]), [pdfNotesVisible, setPdfNotesVisible] = useState(false)
  const clearSelection = useCallback(() => {setSelection(null); return reader.current?.clearSelection().catch(() => undefined)}, [])
  const revoke = useCallback(() => {
    setSelection(null); setPdfMarkInfos([]); setPdfNotesVisible(false); setPanel(null); setDraft(''); setReply(null); setCommentMenu(null); setDeletingComment(null); setDiscard(null)
  }, [setDraft])
  useLayoutEffect(() => {setMarks([]); setMarkProfiles([]); revoke()}, [cacheKey, revoke])
  const markDetail = useMemo(() => {
    try {return buildReaderMarks(marks, markProfiles, user, policy)}
    catch (error) {return {mark_list: [], user_list: {}, error: error instanceof Error ? error.message : 'Invalid legacy annotations'}}
  }, [marks, markProfiles, user, policy])
  useEffect(() => {
    setMarks([])
    if (!repositories || !bookmarkId || isPreview || isCollection && !collectionOwnerId || !isAccountActive()) return
    let active = true
    const unsubscribe = repositories.watchComments(bookmarkId, rows => {if (active && isAccountActive()) setMarks(policy.showMarks ? rows : [])}, error => {if (active) fail(error)}, {collectionOwnerId, enabled: policy.showMarks})
    return () => {active = false; unsubscribe()}
  }, [repositories, bookmarkId, collectionOwnerId, isCollection, isPreview, policy.showMarks, isAccountActive])
  useEffect(() => {
    if (!documentReady || !appActive || scope.routeVisible === false || !bookmarkId || !policy.showMarks || !policy.showProfile || !repositories || !isAccountActive()) return
    const unknown = marks.some(mark => {const id = String(jsonObject(mark.metadata).user_id ?? ''); return id && id !== currentUserId && !markProfiles.some(profile => profile.uuid === id)})
    if (!unknown) return
    const controller = new AbortController()
    void api.getMarkUsers(bookmarkId, controller.signal).then(profiles => {if (!controller.signal.aborted && isAccountActive()) {setMarkProfiles(profiles); return repositories.local.update(cacheKey, {mark_users: JSON.stringify(profiles)})}}).catch(() => undefined)
    return () => controller.abort()
  }, [documentReady, appActive, scope.routeVisible, api, bookmarkId, cacheKey, marks, markProfiles, repositories, currentUserId, policy.showMarks, policy.showProfile, isAccountActive])
  useEffect(() => {if (!policy.showMarks) {setSelection(null); setPanel(null); setDraft(''); setReply(null); setCommentMenu(null); setDeletingComment(null)}}, [policy.showMarks])
  useEffect(() => {if (!panel) setCommentMenu(null)}, [panel])
  useEffect(() => {if ('error' in markDetail && markDetail.error) fail(new Error(markDetail.error))}, [markDetail, fail])
  useEffect(() => {if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer)}, [copied])
  const dismissPanel = () => {
    if (draftState.getSnapshot().trim()) {setDiscard('panel'); return}
    setPanel(null); setReply(null); void clearSelection()
  }
  const copyText = async () => {
    if (!isAccountActive()) return
    const captured = !panel ? await reader.current?.captureSelection() : null
    if (!mounted.current || !isAccountActive()) return
    await Clipboard.setStringAsync(captured?.text || panel?.text || selection?.text || '')
    if (!mounted.current || !isAccountActive()) return
    setCopied(true)
    if (panel) dismissPanel(); else await clearSelection()
  }
  const assertCurrentSelection = (source: ReaderSelection['source'] | ReaderMarkItem['source']) => {
    if (!isPdf && !source.some(item => item.type === 'pdf')) return
    const descriptor = pdfSnapshot.current
    try {
      if (!descriptor || !validatePdfSources(source, descriptor.document_id) || source.some(item => item.type !== 'pdf' || descriptor.pages !== undefined && item.page > descriptor.pages)) throw new Error('Invalid PDF selection')
    } catch {throw new Error(t('pdf_selection_invalid'))}
  }
  const capturedSelection = async (): Promise<ReaderSelection | null> => panel ? panel.captured ?? selectionForMark(panel.mark, panel.text) : await reader.current?.captureSelection() ?? null
  const highlight = async () => {
    if (!repositories || markBusy || !currentUserId || !isAccountActive()) return
    const selected = panel?.mark ?? selection?.mark, removing = Boolean(selected?.stroke.length)
    if (!removing && !policy.allowLine) return
    setMarkBusy(true)
    try {
      if (removing) {
        if (selected) assertCurrentSelection(selected.source)
        const record = sourceStrokeToRemove(marks, selected, currentUserId)
        if (record) await repositories.deleteMark(record.id, policy, currentUserId)
      } else {
        const captured = await capturedSelection()
        if (!mounted.current || !isAccountActive()) return
        if (captured?.source.length) {
          assertCurrentSelection(captured.source)
          await repositories.addMark({bookmarkId, userId: currentUserId, type: 1, source: selectionPaths(captured), approxSource: captured.approx_source, selectContent: captured.select_content, markPolicy: policy})
        }
      }
      if (!mounted.current || !isAccountActive()) return
      if (panel) dismissPanel(); else await clearSelection()
    } finally {if (mounted.current) setMarkBusy(false)}
  }
  const startComment = async () => {
    if (!foreground.current || !policy.allowComment || !selection || !isAccountActive()) return
    const captured = await reader.current?.captureSelection()
    if (!captured || !mounted.current || !foreground.current || !isAccountActive()) return
    assertCurrentSelection(captured.source)
    setPanel({mark: {...selection.mark, source: selectionPaths(captured), approx: captured.approx_source}, text: captured.text || selection.text, autoFocus: true, captured})
    await clearSelection()
  }
  const submitComment = async () => {
    if (!repositories || !panel || !draftState.getSnapshot().trim() || !policy.allowComment || markBusy || !currentUserId || !isAccountActive()) return
    const captured = panel.captured ?? selectionForMark(panel.mark, panel.text)
    assertCurrentSelection(captured.source)
    const parent = reply ? marks.find(mark => sourceStableId(mark.id) === reply.markId) : null
    const rootId = parent ? String(jsonObject(parent.metadata).root_id || parent.id) : null
    const submitted = draftState.getSnapshot()
    setMarkBusy(true)
    try {
      await repositories.addMark({bookmarkId, userId: currentUserId, type: parent ? 3 : 2, source: selectionPaths(captured), approxSource: captured.approx_source, selectContent: captured.select_content, comment: submitted.trim(), parentId: parent?.id, rootId, markPolicy: policy})
      if (mounted.current && isAccountActive()) {if (draftState.getSnapshot() === submitted) setDraft(''); setReply(null); await clearSelection()}
    } finally {if (mounted.current && isAccountActive()) setMarkBusy(false)}
  }
  const handleEvent = (event: ReaderEvent) => {
    if ((event.type === 'textSelected' || event.type === 'markClicked') && event.mark && isPdf) {
      try {assertCurrentSelection(event.mark.source)} catch (error) {fail(error); return}
    }
    if (event.type === 'textSelected') setSelection({mark: policy.showMarks ? event.mark : {...event.mark, id: '', stroke: [], comments: []}, text: event.text, y: event.containerYPoints ?? -1})
    else if (event.type === 'textDeselected') setSelection(null)
    else if (event.type === 'markClicked' && event.mark && policy.showMarks) {setSelection(null); setPanel({mark: event.mark, text: event.text, autoFocus: false})}
    else if (event.type === 'markItemInfosChanged') {
      if (!policy.showMarks) return
      const infos = isPdf ? event.marks.filter(mark => {try {assertCurrentSelection(mark.source); return true} catch {return false}}) : event.marks
      if (isPdf) setPdfMarkInfos(infos)
      setPanel(previous => previous ? {...previous, mark: refreshSelectedMark(previous.mark, infos)} : null)
      setSelection(previous => previous ? {...previous, mark: refreshSelectedMark(previous.mark, infos)} : null)
    } else if (event.type === 'selectionError') fail(new Error(isPdf ? t('pdf_selection_invalid') : event.error))
  }
  const openNote = async (mark: ReaderMarkItem) => {
    assertCurrentSelection(mark.source)
    if (!await reader.current?.scrollToAnchor(mark.id)) throw new Error(t('pdf_selection_invalid'))
    if (!mounted.current || !isAccountActive()) return
    setPdfNotesVisible(false); setPanel({mark, text: selectionForMark(mark, '').text, autoFocus: false})
  }
  const copyComment = async (comment: ReaderComment) => {
    if (!comment.isDeleted && isAccountActive()) {await Clipboard.setStringAsync(comment.comment); if (mounted.current && isAccountActive()) setCopied(true)}
  }
  const canDelete = (comment: ReaderComment) => policy.showMarks && Boolean(currentUserId) && (!isCollection || comment.userId === stableUserId)
  const requestDelete = (comment: ReaderComment) => {if (canDelete(comment) && !comment.isDeleted && isAccountActive()) setDeletingComment(comment)}
  const confirmDelete = async () => {
    const comment = deletingComment; setDeletingComment(null)
    const record = marks.find(mark => comment && sourceStableId(mark.id) === comment.markId)
    if (record && isAccountActive()) await repositories?.deleteMark(record.id, policy, currentUserId)
  }
  const discardDraft = () => {setDiscard(null); setDraft(''); setReply(null); setPanel(null); void clearSelection()}
  return {markDetail, selection, panel, draftState, reply, markBusy, discard, deletingComment, commentMenu, copied, pdfMarkInfos, pdfNotesVisible,
    clearSelection, dismissPanel, copyText, highlight, startComment, submitComment, handleEvent, openNote, copyComment, canDelete, requestDelete, confirmDelete, discardDraft, revoke,
    hydrateProfiles: setMarkProfiles, documentChanged: () => {setSelection(null); setPdfMarkInfos([])}, background: () => setPanel(previous => previous ? {...previous, autoFocus: false} : null),
    setDraft, setCommentMenu, replyTo: (value: ReaderComment | null) => {setReply(value); setDraft('')}, cancelDelete: () => setDeletingComment(null), cancelDiscard: () => setDiscard(null),
    closeNotes: () => setPdfNotesVisible(false), openNotes: () => {if (pdfSnapshot.current && policy.showMarks && pdfMarkInfos.length) {void clearSelection(); setPdfNotesVisible(true)}}}
}
