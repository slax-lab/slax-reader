import React from 'react'
import {StyleSheet, View} from 'react-native'
import {SourceText, TextAction} from '../../components'
import {SourceCircularProgress} from '../../components/SourceRing'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {PdfWebView} from '../PdfWebView'
import {ReaderWebView} from '../index'
import {ReaderSkeleton} from '../ReaderSkeleton'
import type {Translate} from '../state/types'

type PdfProps = React.ComponentProps<typeof PdfWebView>
type HtmlProps = React.ComponentProps<typeof ReaderWebView>
interface ContentProps {
  isPdf: boolean; isPreview: boolean; loading: boolean; html: string | null
  pdfProps: PdfProps | null; htmlProps: HtmlProps
  hostKey: string; top: number; header: React.ReactNode; title: string
  contentError: string | null; nativeFailure: string | null; rssError: string | null; t: Translate
  reload(force?: boolean): void; retryPdf(): void; retryNative(): void
}
export function ReaderContent({isPdf, isPreview, loading, html, pdfProps, htmlProps, hostKey, top, header, title, contentError, nativeFailure, rssError, t, reload, retryPdf, retryNative}: ContentProps) {
  return <>
    {isPdf ? pdfProps && !contentError ? <PdfWebView key={hostKey} {...pdfProps} /> :
      <View style={styles.center} testID="reader-pdf-loading-or-error">{loading ? <><SourceCircularProgress color={C.accent} /><SourceText>{t('pdf_loading')}</SourceText></> : <><SourceText>{contentError || t('pdf_load_failed')}</SourceText><TextAction label={t('rss_retry')} onPress={retryPdf} /></>}</View> :
      html !== null ? <ReaderWebView key={hostKey} {...htmlProps} /> :
      isPreview ? <View testID="reader-rss-loading-or-error" style={styles.center}>{loading ? <SourceCircularProgress color={C.rssAccent} /> : <><SourceText>{t(`rss_error_${rssError ?? 'source_unavailable'}`)}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload()} /></>}</View> :
      loading ? <ReaderSkeleton topSpacer={top + 44} header={title ? header : undefined} /> :
      <View style={styles.center}><SourceText>{t('load_bookmark_content_error')}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload()} /></View>}
    {contentError && !isPdf ? <View style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{contentError}</SourceText><TextAction label={t('rss_retry')} onPress={() => reload(true)} /></View> : null}
    {nativeFailure ? <View testID="reader-native-retry" style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{nativeFailure}</SourceText><TextAction label={t('rss_retry')} onPress={retryNative} /></View> : null}
  </>
}
const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20},
  errorBanner: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: C.background, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'},
})
