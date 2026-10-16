import {useCallback, useEffect, useRef, useState} from 'react'

export type ImageActionSurface = 'document' | 'gallery'
export interface ImageActionRequest {id: number; source: string; surface: ImageActionSurface}
export interface ImageActionPort {
  save(uri: string): Promise<void>
  share(uri: string): Promise<void>
  feedback?(): void
  isPermissionDenied?(error: unknown): boolean
  /** Removes expired staged copies left behind by earlier shares. */
  prune?(): void
}
export type ImageActionNotice = 'saved' | 'save_failed' | 'save_permission' | 'share_failed'
type Choice = 'save' | 'share'

/**
 * WeChat-style long-press actions for a reader image. The sheet closes first; the system permission prompt,
 * photo-library write or share sheet starts only after the dismissal completes, and stale results are discarded.
 */
export function useImageActions({port, resolveUri, isActive}: {
  port?: ImageActionPort
  resolveUri(uri: string, signal?: AbortSignal): Promise<string | null>
  isActive(): boolean
}) {
  const [request, setRequest] = useState<ImageActionRequest | null>(null)
  const [visible, setVisible] = useState(false)
  const [notice, setNotice] = useState<{kind: ImageActionNotice; surface: ImageActionSurface} | null>(null)
  const sequence = useRef(0), choice = useRef<Choice | null>(null), work = useRef<AbortController | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef({port, resolveUri, isActive}); current.current = {port, resolveUri, isActive}
  const announce = useCallback((kind: ImageActionNotice, surface: ImageActionSurface) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice({kind, surface})
    noticeTimer.current = setTimeout(() => {noticeTimer.current = null; setNotice(null)}, 1800)
  }, [])
  const reset = useCallback(() => {
    work.current?.abort(); work.current = null; choice.current = null
    setVisible(false); setRequest(null)
  }, [])
  useEffect(() => reset(), [resolveUri, reset])
  useEffect(() => {try {current.current.port?.prune?.()} catch {}}, [port])
  useEffect(() => () => {work.current?.abort(); if (noticeTimer.current) clearTimeout(noticeTimer.current)}, [])
  const open = useCallback((source: string, surface: ImageActionSurface) => {
    if (!current.current.port || !current.current.isActive() || !source) return
    work.current?.abort(); work.current = null; choice.current = null
    current.current.port.feedback?.()
    setRequest({id: ++sequence.current, source, surface}); setVisible(true)
  }, [])
  const choose = useCallback((next: Choice) => {choice.current = next; setVisible(false)}, [])
  const cancel = useCallback(() => {choice.current = null; setVisible(false)}, [])
  const dismissed = useCallback(() => {
    const target = request, selected = choice.current, owner = current.current
    choice.current = null; setRequest(null)
    if (!target || !selected || !owner.port || !owner.isActive()) return
    const controller = new AbortController(); work.current?.abort(); work.current = controller
    const live = () => work.current === controller && !controller.signal.aborted && current.current.isActive()
    void (async () => {
      try {
        const uri = await owner.resolveUri(target.source, controller.signal)
        if (!live()) return
        if (!uri?.startsWith('file://')) throw new Error('Image is unavailable')
        if (selected === 'save') {await owner.port!.save(uri); if (live()) announce('saved', target.surface)}
        else await owner.port!.share(uri)
      } catch (error) {
        if (!live() || (error instanceof Error && error.name === 'AbortError')) return
        announce(selected === 'share' ? 'share_failed' : owner.port!.isPermissionDenied?.(error) ? 'save_permission' : 'save_failed', target.surface)
      } finally {if (work.current === controller) work.current = null}
    })()
  }, [request, announce])
  return {request, visible, notice, open, save: useCallback(() => choose('save'), [choose]), share: useCallback(() => choose('share'), [choose]), cancel, dismissed, reset}
}
