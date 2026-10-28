import React, {useCallback, useMemo, useState} from 'react'
import {Platform, StyleSheet, View} from 'react-native'
import {SourceText, TextAction} from '../../components'
import {SourceCircularProgress} from '../../components/SourceRing'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {ReaderWebView} from '../index'
import {ReaderLoadingCover} from '../ReaderLoadingCover'
import {ReaderSkeleton} from '../ReaderSkeleton'
import type {Translate} from '../state/types'

type PdfProps = React.ComponentProps<typeof import('../PdfWebView').PdfWebView>
type HtmlProps = React.ComponentProps<typeof ReaderWebView>
function PdfWebView(props: PdfProps) {
  const Viewer = (require('../PdfWebView') as typeof import('../PdfWebView')).PdfWebView
  return <Viewer {...props} />
}
interface ContentProps {
  isPdf: boolean; isPreview: boolean; loading: boolean; html: string | null
  pdfProps: PdfProps | null; htmlProps: HtmlProps
  hostKey: string; top: number; header: React.ReactNode; title: string
  /**
   * Android creates the native document host only after the route's push transition settled (its transition shares the UI thread).
   * iOS creates it immediately beneath the skeleton, since its push animation runs in Core Animation.
   */
  transitionReady: boolean
  contentError: string | null; nativeFailure: string | null; rssError: string | null; t: Translate
  reload(force?: boolean): void; retryPdf(): void; retryNative(): void
}
export function ReaderContent({isPdf, isPreview, loading, html, pdfProps, htmlProps, hostKey, top, header, title, transitionReady, contentError, nativeFailure, rssError, t, reload, retryPdf, retryNative}: ContentProps) {
  // The inputs of ReaderWebView's page identity: a change creates a new page (for example a forced reload that publishes new HTML
  // under the same host key), which stays covered until it reports its own presentable.
  const {html: pageHtml, cacheKey, rewriteImageTransports, resourceOwner, currentUserId, baseUrl} = htmlProps
  const page = useMemo(() => ({hostKey, pageHtml, cacheKey, rewriteImageTransports, resourceOwner, currentUserId, baseUrl}),
    [hostKey, pageHtml, cacheKey, rewriteImageTransports, resourceOwner, currentUserId, baseUrl])
  const [presentedPage, setPresentedPage] = useState<typeof page | null>(null)
  const presentable = useCallback(() => setPresentedPage(page), [page])
  const skeleton = <ReaderSkeleton topSpacer={top + 44} header={title ? header : undefined} />
  const hostReady = transitionReady || Platform.OS === 'ios'
  const htmlHost = html !== null && hostReady
  // One skeleton covers loading and the mounted host until its restored first screen has painted (DOM ready + restore + a frame),
  // so the transparent WebView never shows blank or the article top first. Errors uncover at once so their banners show.
  const covered = !htmlHost || (presentedPage !== page && !contentError && !nativeFailure)
  const article = <View style={styles.layer}>
    {htmlHost ? <View style={styles.layer} accessibilityElementsHidden={covered} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
      <ReaderWebView key={hostKey} {...htmlProps} onPresentable={presentable} />
    </View> : null}
    <ReaderLoadingCover testID="reader-loading-cover" covered={covered}>{skeleton}</ReaderLoadingCover>
  </View>
  return <>
    {/* A PDF opens like an article: the same header + skeleton covers the host until its first visible page is painted. */}
    {isPdf ? pdfProps && !contentError ? <PdfWebView key={hostKey} {...pdfProps} placeholder={skeleton} /> :
      loading && !contentError ? skeleton :
      <View style={styles.center} testID="reader-pdf-loading-or-error"><SourceText>{contentError || t('pdf_load_failed')}</SourceText><TextAction label={t('rss_retry')} onPress={retryPdf} /></View> :
      isPreview ? html !== null ? hostReady ? <ReaderWebView key={hostKey} {...htmlProps} /> : <View style={styles.center}><SourceCircularProgress color={C.rssAccent} /></View> :
        <View testID="reader-rss-loading-or-error" style={styles.center}>{loading ? <SourceCircularProgress color={C.rssAccent} /> : <><SourceText>{t(`rss_error_${rssError ?? 'source_unavailable'}`)}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload()} /></>}</View> :
      html !== null || loading ? article :
      <View style={styles.center}><SourceText>{t('load_bookmark_content_error')}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload()} /></View>}
    {contentError && !isPdf ? <View style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{contentError}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload(true)} /></View> : null}
    {nativeFailure ? <View testID="reader-native-retry" style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{nativeFailure}</SourceText><TextAction label={t('rss_retry')} onPress={retryNative} /></View> : null}
  </>
}
const styles = StyleSheet.create({
  layer: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20},
  errorBanner: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: C.background, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'},
})
