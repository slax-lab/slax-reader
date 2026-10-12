import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MobileAssetName } from '../../assets'
import { SourceAvatar, SourceIcon, SourceText, TextAction } from '../components'
import type { createTranslator } from '../i18n'
import { mobileColors as C, mobileTypography as T } from '../theme'
import { selectionMenuTop } from './coordinates.ts'
import { MarkdownView } from './MarkdownView.tsx'
import { activeYoutubeCue, cueTime, sourceDisplayTime, type YoutubeCue } from './model.ts'
import type { ReaderComment, ReaderMarkItem } from './types.ts'

type Translate = ReturnType<typeof createTranslator>
export function IconAction({name, label, onPress, size = 24, disabled = false, testID}: {name: MobileAssetName; label: string; onPress(): void; size?: number; disabled?: boolean; testID?: string}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} testID={testID} hitSlop={8} style={({pressed}) => [{opacity: disabled ? 0.4 : pressed ? 0.5 : 1, padding: 8}]}><SourceIcon name={name} size={size} /></Pressable>
}

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
  const offset = useRef(new Animated.Value(visible ? 0 : 150)).current
  useEffect(() => {Animated.timing(offset, {toValue: visible ? 0 : 150, duration: 300, useNativeDriver: true}).start()}, [visible, offset])
  return <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.floating, {bottom: inset.bottom + 24, transform: [{translateY: offset}]}]}>
    {outlineCollapsed ? <View style={styles.floatingCircle}><IconAction name="ic_outline_collapsed" label={t('outline_expand')} size={24} onPress={onOutline} /></View> : null}
    {!isCollection ? <View style={styles.floatingPill}>
      <IconAction name={starred ? 'ic_floating_panel_starred' : 'ic_floating_panel_star'} label={t(starred ? 'bookmark_unstar' : 'bookmark_star')} size={20} onPress={onStar} />
      <IconAction name={archived ? 'ic_floating_panel_archieved' : 'ic_floating_panel_archieve'} label={t(archived ? 'bookmark_unarchive' : 'bookmark_archive')} size={20} onPress={onArchive} />
    </View> : null}
    <View style={styles.floatingCircle}><IconAction name="ic_floating_panel_more" label={t('detail_toolbar_summary')} size={20} onPress={onMore} /></View>
  </Animated.View>
}

export function ReaderSheet({visible, onDismiss, children, testID, inline = false}: {visible: boolean; onDismiss(): void; children: React.ReactNode; testID?: string; inline?: boolean}) {
  const inset = useSafeAreaInsets()
  const content = <KeyboardAvoidingView style={{flex: 1, justifyContent: 'flex-end'}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable accessible={false} onPress={onDismiss} style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim}]} />
      <View testID={testID} accessibilityViewIsModal style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}]}>{children}</View>
    </KeyboardAvoidingView>
  if (inline) return visible ? <View style={[StyleSheet.absoluteFill, {zIndex: 5}]}>{content}</View> : null
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onDismiss}>{content}</Modal>
}

export function ReaderToolbar({visible, collection, youtube, starred, archived, t, onDismiss, onAction}: {visible: boolean; collection: boolean; youtube: boolean; starred: boolean; archived: boolean; t: Translate; onDismiss(): void; onAction(id: string): void}) {
  const actions: {id: string; label: string; icon: MobileAssetName; pro?: boolean}[] = [
    {id: 'outline', label: t('detail_toolbar_summary'), icon: 'ic_bottom_panel_summary', pro: true},
    ...(youtube ? [{id: 'transcript', label: t('detail_toolbar_transcript'), icon: 'ic_bottom_panel_transcript' as const}] : []),
    ...(!collection ? [{id: 'star', label: t(starred ? 'detail_toolbar_unstar' : 'detail_toolbar_star'), icon: starred ? 'ic_bottom_panel_starred' as const : 'ic_bottom_panel_star' as const},
      {id: 'archive', label: t(archived ? 'detail_toolbar_unarchive' : 'detail_toolbar_archive'), icon: archived ? 'ic_bottom_panel_archieved' as const : 'ic_bottom_panel_archieve' as const},
      {id: 'edit', label: t('detail_toolbar_edit_title'), icon: 'ic_bottom_panel_edittitle' as const}] : []),
    {id: 'share', label: t('detail_toolbar_share'), icon: 'ic_bottom_panel_share'},
    {id: 'feedback', label: t('detail_toolbar_feedback'), icon: 'ic_bottom_panel_feedback'},
    ...(!collection ? [{id: 'delete', label: t('detail_toolbar_delete'), icon: 'ic_bottom_panel_delete' as const}] : []),
  ]
  const inset = useSafeAreaInsets()
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
    <View style={{flex: 1, justifyContent: 'flex-end'}}><Pressable accessible={false} onPress={onDismiss} style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim}]} />
      <View style={[styles.toolbarSheet, {paddingBottom: inset.bottom + 24}]}><View style={styles.toolbarGrid}>{actions.map(action => <Pressable key={action.id} onPress={() => onAction(action.id)} style={styles.toolbarItem} accessibilityRole="button" testID={`reader-toolbar-${action.id}`}>
        <View style={styles.toolbarIcon}><SourceIcon name={action.icon} size={28} />{action.pro ? <SourceIcon name="ic_bottom_panel_pro" size={24} style={{position: 'absolute', right: -4, top: -4}} /> : null}</View>
        <SourceText style={[T.toolbarLabel, {marginTop: 8}]}>{action.label}</SourceText>
      </Pressable>)}</View></View>
    </View>
  </Modal>
}

export function CommentPanel({visible, mark, text, draft, reply, currentUserAvatar, hideProfiles, allowLine, allowComment, autoFocus, busy, t, onDraft, onClose, onCopy, onHighlight, onReply, onDelete, canDelete, onSubmit}: {
  visible: boolean; mark: ReaderMarkItem | null; text: string; draft: string; reply: ReaderComment | null; currentUserAvatar: string;
  hideProfiles: boolean; allowLine: boolean; allowComment: boolean; autoFocus: boolean; busy: boolean; t: Translate;
  onDraft(value: string): void; onClose(): void; onCopy(): void; onHighlight(): void; onReply(comment: ReaderComment | null): void;
  onDelete(comment: ReaderComment): void; canDelete(comment: ReaderComment): boolean; onSubmit(): void;
}) {
  const window = useWindowDimensions()
  const stroke = Boolean(mark?.stroke.length)
  const row = (comment: ReaderComment, child = false) => <View key={comment.markId} style={[styles.commentRow, child && {marginLeft: 36}]}>
    {!hideProfiles ? <SourceAvatar uri={comment.avatar} size={28} label={t('comment_panel_user_avatar')} /> : null}
    <View style={{flex: 1}}>
      {!hideProfiles ? <SourceText style={{fontSize: 14, fontWeight: '500', lineHeight: 21}}>{comment.username || t('comment_panel_unknown_user')}</SourceText> : null}
      <Pressable onPress={() => {if (allowComment && !comment.isDeleted) onReply(comment)}} onLongPress={() => {if (canDelete(comment) && !comment.isDeleted) onDelete(comment)}}>
        <SourceText style={{fontSize: 14, lineHeight: 21, color: comment.isDeleted ? C.mutedText : C.bodyText}}>{comment.reply && !comment.isDeleted ? `${t('comment_panel_reply_prefix')}${comment.reply.username || t('comment_panel_unknown_user')}: ` : ''}{comment.isDeleted ? t('comment_panel_deleted') : comment.comment}</SourceText>
      </Pressable>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><SourceText style={{fontSize: 11, color: C.mutedText}}>{sourceDisplayTime(comment.createdAt) || comment.createdAt}</SourceText>
        {canDelete(comment) && !comment.isDeleted ? <IconAction name="ic_comment_panel_delete" label={t('comment_panel_delete')} size={14} onPress={() => onDelete(comment)} /> : null}
      </View>
      {!child ? comment.children.map(replyComment => row(replyComment, true)) : null}
    </View>
  </View>
  return <ReaderSheet visible={visible} onDismiss={onClose} testID="reader-comment-panel" inline>
    <View style={{height: window.height * 0.8, maxHeight: '100%'}}>
      <View style={{alignItems: 'flex-end', padding: 8}}><IconAction name="ic_comment_panel_close" label={t('comment_panel_close')} onPress={onClose} /></View>
      <View style={{paddingHorizontal: 20, paddingBottom: 12}}>
        <ScrollView style={{maxHeight: 112}}><SourceText selectable style={{fontSize: 15, lineHeight: 24, textDecorationLine: stroke || mark?.comments.length ? 'underline' : 'none', textDecorationColor: C.markStroke, textDecorationStyle: stroke ? 'solid' : 'dashed'}}>{text}</SourceText></ScrollView>
        <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8}}><IconAction name="ic_comment_panel_copy" label={t('comment_panel_copy')} onPress={onCopy} />
          {stroke || allowLine ? <IconAction name={stroke ? 'ic_comment_panel_highlighted' : 'ic_comment_panel_highlight'} label={t(stroke ? 'comment_panel_remove_highlight' : 'comment_panel_highlight')} onPress={onHighlight} disabled={busy} /> : null}</View>
      </View>
      <ScrollView style={{flex: 1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 12}}>{mark?.comments.map(comment => row(comment))}</ScrollView>
      {allowComment ? <View style={styles.commentEditor}>
        {!hideProfiles ? <SourceAvatar uri={currentUserAvatar} size={28} label={t('comment_panel_current_user_avatar')} /> : null}
        <View style={{flex: 1}}>{reply ? <Pressable onPress={() => onReply(null)}><SourceText style={[T.helper, {color: C.link}]}>{t('comment_panel_reply_prefix')}{reply.username || t('comment_panel_unknown_user')}</SourceText></Pressable> : null}
          <TextInput testID="reader-comment-input" autoFocus={autoFocus} multiline maxLength={1500} value={draft} onChangeText={onDraft} placeholder={t('comment_panel_placeholder')} placeholderTextColor={C.mutedText} selectionColor={C.textSelection} style={styles.commentInput} />
        </View><TextAction label={t('comment_panel_send')} disabled={!draft.trim() || busy} onPress={onSubmit} /></View> : null}
    </View>
  </ReaderSheet>
}

export function OutlineSheet({visible, markdown, pending, busy, error, position, t, onClose, onCollapse, onRetry, onLink, onPosition}: {visible: boolean; markdown: string; pending: boolean; busy: boolean; error: string | null; position: number; t: Translate; onClose(): void; onCollapse(): void; onRetry(): void; onLink(href: string): void; onPosition(position: number): void}) {
  const viewport = useWindowDimensions()
  return <ReaderSheet visible={visible} onDismiss={onClose} testID="reader-outline-panel"><View style={{height: viewport.height * 0.88}}>
    <View style={styles.sheetHeading}><SourceText style={{fontSize: 16, fontWeight: '500'}}>{t(busy ? 'outline_summarizing' : 'outline_completed')}</SourceText><View style={{flexDirection: 'row'}}>
      <IconAction name="ic_outline_dialog_shrink" label={t('outline_minimize')} onPress={onCollapse} /><IconAction name="ic_outline_dialog_close" label={t('btn_close')} onPress={onClose} /></View></View>
    {error ? <View style={styles.center}><SourceText style={[T.helper, {color: C.mutedText}]}>{t('outline_error')}</SourceText><SourceText style={[T.helper, {color: C.mutedText}]}>{error}</SourceText><TextAction label={t('rss_retry')} onPress={onRetry} /></View> : pending && busy ? <View style={styles.center}><ActivityIndicator color={C.bodyText} /><SourceText style={[T.helper, {marginTop: 12}]}>{t('outline_summarizing')}</SourceText></View> :
      <MarkdownView markdown={markdown || t('outline_empty')} initialPosition={position} onLink={onLink} onPosition={onPosition} />}
    {busy && !pending ? <View style={{padding: 10}}><ActivityIndicator color={C.bodyText} /></View> : null}
  </View></ReaderSheet>
}

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
  floating: {position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 12}, floatingPill: {height: 50, borderRadius: 25, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, gap: 7, borderWidth: 1, borderColor: C.surface, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8}, floatingCircle: {width: 50, height: 50, borderRadius: 25, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8},
  readerSheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.readerBackground, overflow: 'hidden', maxHeight: '96%'},
  toolbarSheet: {backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24, paddingHorizontal: 12}, toolbarGrid: {flexDirection: 'row', flexWrap: 'wrap', rowGap: 24}, toolbarItem: {width: '25%', alignItems: 'center'}, toolbarIcon: {width: 56, height: 56, borderRadius: 16, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center'},
  commentRow: {flexDirection: 'row', gap: 8, marginBottom: 16}, commentEditor: {flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 0.5, borderTopColor: C.border, paddingHorizontal: 20, paddingVertical: 12}, commentInput: {padding: 0, fontSize: 14, lineHeight: 21, minHeight: 36, maxHeight: 120, color: C.bodyText, includeFontPadding: false},
  sheetHeading: {paddingTop: 16, paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20}, cue: {padding: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 6}, cueTime: {fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#2F9E5E', backgroundColor: '#8AD8A829', borderWidth: 1, borderColor: '#8AD8A880', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3}, closeRow: {height: 55, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6},
})
