import React, {useEffect, useRef} from 'react'
import {FlatList, Pressable, StyleSheet, View, useWindowDimensions} from 'react-native'
import Reanimated, {cancelAnimation, Easing as UiEasing, ReduceMotion, useSharedValue, withTiming, useAnimatedStyle} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import type {MobileAssetName} from '../../assets'
import {SourceIcon, SourceText} from '../components'
import {SourceSheetModal} from '../components/SourceSheetModal'
import {mobileColors as C, mobileTypography as T} from '../theme'
import {selectionMenuTop} from './coordinates.ts'
import {activeYoutubeCue, cueTime, type YoutubeCue} from './model.ts'
import type {Translate} from './state/types'
import {ReaderSheet} from './components/ReaderSheet'
import {IconAction} from './components/IconAction'

export function SelectionMenu({y, height, minTop = 0, hasStroke, allowLine, allowComment, t, onCopy, onHighlight, onComment}: {y: number; height: number; minTop?: number; hasStroke: boolean; allowLine: boolean; allowComment: boolean; t: Translate; onCopy(): void; onHighlight(): void; onComment(): void}) {
  if (y <= 0 || y >= height) return null
  const actions: {name: MobileAssetName; label: string; press(): void}[] = [
    {name: 'ic_menu_action_copy', label: t('selection_action_copy'), press: onCopy},
    ...(hasStroke || allowLine ? [{name: 'ic_menu_action_highlight' as const, label: t(hasStroke ? 'selection_action_remove_highlight' : 'selection_action_highlight'), press: onHighlight}] : []),
    ...(allowComment ? [{name: 'ic_menu_action_comment' as const, label: t('selection_action_comment'), press: onComment}] : []),
  ]
  return <View pointerEvents="box-none" style={[styles.selectionContainer, {top: selectionMenuTop(y, height, minTop)}]}>
    <View testID="selection_action_bar" style={styles.selectionMenu}>{actions.map(action => <Pressable key={action.label} onPress={action.press} accessibilityRole="button" style={({pressed}) => [styles.selectionAction, {backgroundColor: pressed ? C.selectionMenuPressed : C.selectionMenu}]}>
      <SourceIcon name={action.name} size={20} /><SourceText style={[T.selectionAction, {color: C.selectionText}]}>{action.label}</SourceText>
    </Pressable>)}</View>
  </View>
}

export function FloatingActions({visible, isCollection, starred, archived, outlineCollapsed, t, onStar, onArchive, onMore, onOutline}: {visible: boolean; isCollection: boolean; starred: boolean; archived: boolean; outlineCollapsed: boolean; t: Translate; onStar(): void; onArchive(): void; onMore(): void; onOutline(): void}) {
  const inset = useSafeAreaInsets()
  const offset = useSharedValue(visible ? 0 : 150)
  const horizontal = useSharedValue(0)
  useEffect(() => {offset.value = withTiming(visible ? 0 : 150, {duration: 300, reduceMotion: ReduceMotion.System}); return () => cancelAnimation(offset)}, [visible, offset])
  useEffect(() => {horizontal.value = withTiming(outlineCollapsed ? 31 : 0, {duration: 350, easing: UiEasing.bezier(.4, 0, .2, 1), reduceMotion: ReduceMotion.System}); return () => cancelAnimation(horizontal)}, [outlineCollapsed, horizontal])
  const style = useAnimatedStyle(() => ({transform: [{translateY: offset.value}, {translateX: horizontal.value}]}))
  return <Reanimated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.floating, {bottom: inset.bottom + 24}, style]}>
    {!isCollection ? <View style={styles.floatingPill}>
      <Pressable accessibilityRole="button" accessibilityLabel={t(starred ? 'bookmark_unstar' : 'bookmark_star')} onPress={onStar} style={({pressed}) => ({width: 50, height: 50, justifyContent: 'center', paddingLeft: 17.5, opacity: pressed ? .5 : 1})}><SourceIcon name={starred ? 'ic_floating_panel_starred' : 'ic_floating_panel_star'} size={20} /></Pressable>
      <Pressable testID="reader-floating-archive" accessibilityRole="button" accessibilityLabel={t(archived ? 'bookmark_unarchive' : 'bookmark_archive')} onPress={onArchive} style={({pressed}) => ({width: 50, height: 50, flexShrink: 0, justifyContent: 'center', alignItems: 'center', opacity: pressed ? .5 : 1})}><SourceIcon name={archived ? 'ic_floating_panel_archieved' : 'ic_floating_panel_archieve'} size={20} testID="reader-floating-archive-icon" /></Pressable>
    </View> : null}
    <View style={styles.floatingCircle}><IconAction name="ic_floating_panel_more" label={t('detail_toolbar_summary')} size={20} onPress={onMore} /></View>
  </Reanimated.View>
}

export {ReaderSheet} from './components/ReaderSheet'

export function ReaderToolbar({visible, collection, youtube, starred, archived, pdf, t, onDismiss, onDidDismiss, onAction}: {visible: boolean; collection: boolean; youtube: boolean; starred: boolean; archived: boolean; pdf?: {notesEnabled: boolean}; t: Translate; onDismiss(): void; onDidDismiss?(): void; onAction(id: string): void}) {
  const actions: {id: string; label: string; icon: MobileAssetName; pro?: boolean; disabled?: boolean}[] = [
    {id: 'outline', label: t('detail_toolbar_summary'), icon: 'ic_bottom_panel_summary', pro: true},
    ...(pdf ? [{id: 'pdf-notes', label: t('pdf_notes'), icon: 'ic_bottom_panel_comment' as const, disabled: !pdf.notesEnabled}] : []),
    ...(youtube ? [{id: 'transcript', label: t('detail_toolbar_transcript'), icon: 'ic_bottom_panel_transcript' as const}] : []),
    ...(!collection ? [{id: 'star', label: t(starred ? 'detail_toolbar_unstar' : 'detail_toolbar_star'), icon: starred ? 'ic_bottom_panel_starred' as const : 'ic_bottom_panel_star' as const},
      {id: 'archive', label: t(archived ? 'detail_toolbar_unarchive' : 'detail_toolbar_archive'), icon: archived ? 'ic_bottom_panel_archieved' as const : 'ic_bottom_panel_archieve' as const},
      {id: 'edit', label: t('detail_toolbar_edit_title'), icon: 'ic_bottom_panel_edittitle' as const}] : []),
    {id: 'share', label: t('detail_toolbar_share'), icon: 'ic_bottom_panel_share'},
    {id: 'feedback', label: t('detail_toolbar_feedback'), icon: 'ic_bottom_panel_feedback'},
    ...(!collection ? [{id: 'delete', label: t('detail_toolbar_delete'), icon: 'ic_bottom_panel_delete' as const}] : []),
  ]
  const inset = useSafeAreaInsets()
  return <SourceSheetModal visible={visible} onDismiss={onDismiss} onDidDismiss={onDidDismiss}>
    <View style={[styles.toolbarSheet, {paddingBottom: inset.bottom + 24}]}><View style={styles.toolbarGrid}>{actions.map(action => <Pressable key={action.id} onPress={() => {if (!action.disabled) onAction(action.id)}} disabled={action.disabled} accessibilityState={{disabled: Boolean(action.disabled)}} style={[styles.toolbarItem, action.disabled && {opacity: .4}]} accessibilityRole="button" accessibilityLabel={action.label} testID={`reader-toolbar-${action.id}`}>
      <View style={styles.toolbarIcon}><SourceIcon name={action.icon} size={28} />{action.pro ? <SourceIcon name="ic_bottom_panel_pro" size={24} style={{position: 'absolute', right: -4, top: -4}} /> : null}</View>
      <SourceText style={[T.toolbarLabel, {marginTop: 8}]}>{action.label}</SourceText>
    </Pressable>)}</View></View>
  </SourceSheetModal>
}

/** WeChat-style long-press image sheet: save and share above a separated cancel row. */
export function ImageActionSheet({visible, t, onSave, onShare, onCancel, onDidDismiss}: {visible: boolean; t: Translate; onSave(): void; onShare(): void; onCancel(): void; onDidDismiss(): void}) {
  const inset = useSafeAreaInsets()
  const row = (testID: string, label: string, press: () => void) => <Pressable testID={testID} accessibilityRole="button" onPress={press}
    style={({pressed}) => [styles.imageActionRow, pressed && {backgroundColor: C.pressedOverlay}]}><SourceText style={styles.imageActionText}>{label}</SourceText></Pressable>
  return <SourceSheetModal visible={visible} onDismiss={onCancel} onDidDismiss={onDidDismiss}>
    <View testID="reader-image-actions" style={[styles.imageActionSheet, {paddingBottom: inset.bottom}]}>
      {row('reader-image-save', t('image_action_save'), onSave)}
      <View style={styles.imageActionDivider} />
      {row('reader-image-share', t('image_action_share'), onShare)}
      <View style={styles.imageActionGap} />
      {row('reader-image-cancel', t('btn_cancel'), onCancel)}
    </View>
  </SourceSheetModal>
}
export function ImageActionNotice({message}: {message: string | null}) {
  if (!message) return null
  return <View pointerEvents="none" accessibilityLiveRegion="polite" style={styles.imageNotice}><SourceText style={[T.helper, {color: C.surface}]}>{message}</SourceText></View>
}

export {CommentPanel, type CommentMenuAnchor} from './components/CommentPanel'

export {OutlineSheet} from './components/OutlineSheet'

export function TranscriptSheet({visible, cues, currentTime, t, onSeek, onClose}: {visible: boolean; cues: YoutubeCue[]; currentTime: number; t: Translate; onSeek(seconds: number): void; onClose(): void}) {
  const list = useRef<FlatList<YoutubeCue>>(null)
  const viewport = useWindowDimensions()
  const active = activeYoutubeCue(cues, currentTime)
  useEffect(() => {if (visible && active >= 0) list.current?.scrollToIndex({index: active, viewPosition: 0.5, animated: false})}, [visible, active])
  return <ReaderSheet visible={visible} onDismiss={onClose} testID="reader-transcript-panel"><View style={{height: viewport.height * 0.88}}>
    <SourceText style={{fontSize: 16, fontWeight: '500', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8}}>{t('transcript_dialog_title')}</SourceText>
    {cues.length ? <FlatList ref={list} data={cues} keyExtractor={(cue, index) => `${index}:${cue.t}`} style={{flex: 1}} contentContainerStyle={{paddingHorizontal: 16, paddingBottom: 40}}
      onScrollToIndexFailed={info => {list.current?.scrollToOffset({offset: Math.max(0, info.averageItemLength * info.index - 200), animated: false})}}
      renderItem={({item, index}) => <Pressable onPress={() => onSeek(item.t)} style={[styles.cue, index === active && {backgroundColor: '#8AD8A814'}]} accessibilityRole="button">
        <SourceText style={styles.cueTime}>{cueTime(item.t)}</SourceText><SourceText style={{flex: 1, fontSize: 14, lineHeight: 21}}>{item.text}</SourceText>
      </Pressable>} /> : <View style={styles.center}><SourceText style={[T.helper, {color: C.mutedText}]}>{t('transcript_dialog_empty')}</SourceText></View>}
    <Pressable onPress={onClose} style={styles.closeRow} accessibilityRole="button"><SourceIcon name="ic_outline_dialog_close" size={24} /><SourceText style={T.helper}>{t('btn_close')}</SourceText></Pressable>
  </View></ReaderSheet>
}

const styles = StyleSheet.create({
  selectionContainer: {position: 'absolute', left: 0, right: 0, alignItems: 'center'}, selectionMenu: {flexDirection: 'row', height: 44, borderRadius: 8, overflow: 'hidden', backgroundColor: C.selectionMenu}, selectionAction: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12},
  floating: {position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 12}, floatingPill: {height: 50, borderRadius: 25, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.surface, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8}, floatingCircle: {width: 50, height: 50, borderRadius: 25, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8},
  imageActionSheet: {backgroundColor: C.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: 'hidden'},
  imageActionRow: {height: 56, alignItems: 'center', justifyContent: 'center'}, imageActionText: {fontSize: 17, lineHeight: 22, color: C.text},
  imageActionDivider: {height: StyleSheet.hairlineWidth, backgroundColor: C.border}, imageActionGap: {height: 8, backgroundColor: C.background},
  imageNotice: {position: 'absolute', top: 120, alignSelf: 'center', backgroundColor: C.bodyText, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10},
  readerSheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.readerBackground, overflow: 'hidden', maxHeight: '96%'},
  toolbarSheet: {backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24, paddingHorizontal: 12}, toolbarGrid: {flexDirection: 'row', flexWrap: 'wrap', rowGap: 24}, toolbarItem: {width: '25%', alignItems: 'center'}, toolbarIcon: {width: 56, height: 56, borderRadius: 16, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center'},
  commentMeta: {fontSize: 12, lineHeight: 16.5, color: C.mutedText}, commentAction: {flexDirection: 'row', alignItems: 'center', gap: 5},
  commentEditor: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, backgroundColor: C.background}, commentInputContainer: {flex: 1, flexDirection: 'row', gap: 8, minHeight: 38, borderRadius: 8, backgroundColor: C.surface, paddingHorizontal: 8}, commentInput: {paddingVertical: 9, paddingHorizontal: 0, fontSize: 14, lineHeight: 20, minHeight: 38, maxHeight: 100, color: C.bodyText, includeFontPadding: false},
  commentSend: {height: 38, borderRadius: 8, paddingHorizontal: 11.5, alignItems: 'center', justifyContent: 'center'}, commentMenu: {position: 'absolute', flexDirection: 'row', alignItems: 'center', backgroundColor: C.selectionMenu, borderRadius: 12, paddingHorizontal: 6}, commentMenuItem: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 1, paddingLeft: 6, paddingRight: 10, borderRadius: 6}, commentMenuText: {fontSize: 15, lineHeight: 21, fontWeight: '500', color: C.selectionText},
  outlinePanel: {position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.surface, overflow: 'hidden'}, outlineFooterAction: {flex: 1, height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20}, cue: {padding: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 6}, cueTime: {fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#2F9E5E', backgroundColor: '#8AD8A829', borderWidth: 1, borderColor: '#8AD8A880', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3}, closeRow: {height: 55, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6},
})
