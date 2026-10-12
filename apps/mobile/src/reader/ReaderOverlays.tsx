import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, AppState, Easing, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import {outlineMotion, type OutlineStatus} from './outline-motion.ts'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MobileAssetName } from '../../assets'
import { SourceAvatar, SourceIcon, SourceText, TextAction } from '../components'
import {SourceSheetModal} from '../components/SourceSheetModal'
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
  const horizontal = useRef(new Animated.Value(0)).current
  useEffect(() => {const animation = Animated.timing(offset, {toValue: visible ? 0 : 150, duration: 300, useNativeDriver: true}); animation.start(); return () => animation.stop()}, [visible, offset])
  useEffect(() => {const animation = Animated.timing(horizontal, {toValue: outlineCollapsed ? 31 : 0, duration: 350, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true}); animation.start(); return () => animation.stop()}, [outlineCollapsed, horizontal])
  return <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.floating, {bottom: inset.bottom + 24, transform: [{translateY: offset}, {translateX: horizontal}]}]}>
    {!isCollection ? <View style={styles.floatingPill}>
      <Pressable accessibilityRole="button" accessibilityLabel={t(starred ? 'bookmark_unstar' : 'bookmark_star')} onPress={onStar} style={({pressed}) => ({width: 50, height: 50, justifyContent: 'center', paddingLeft: 17.5, opacity: pressed ? .5 : 1})}><SourceIcon name={starred ? 'ic_floating_panel_starred' : 'ic_floating_panel_star'} size={20} /></Pressable>
      <Pressable testID="reader-floating-archive" accessibilityRole="button" accessibilityLabel={t(archived ? 'bookmark_unarchive' : 'bookmark_archive')} onPress={onArchive} style={({pressed}) => ({width: 50, height: 50, flexShrink: 0, justifyContent: 'center', alignItems: 'center', opacity: pressed ? .5 : 1})}><SourceIcon name={archived ? 'ic_floating_panel_archieved' : 'ic_floating_panel_archieve'} size={20} testID="reader-floating-archive-icon" /></Pressable>
    </View> : null}
    <View style={styles.floatingCircle}><IconAction name="ic_floating_panel_more" label={t('detail_toolbar_summary')} size={20} onPress={onMore} /></View>
  </Animated.View>
}

export function ReaderSheet({visible, onDismiss, children, testID, inline = false, comment = false}: {visible: boolean; onDismiss(): void; children: React.ReactNode; testID?: string; inline?: boolean; comment?: boolean}) {
  const inset = useSafeAreaInsets()
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [mounted, setMounted] = useState(visible)
  const motion = useRef(new Animated.Value(0)).current
  const [sheetHeight, setSheetHeight] = useState(0)
  const retained = useRef(children)
  if (visible) retained.current = children
  useEffect(() => {
    if (!comment) return
    if (visible) setMounted(true)
    const animation = Animated.timing(motion, {toValue: visible ? 1 : 0, duration: 300, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true})
    animation.start(({finished}) => {if (finished && !visible) setMounted(false)})
    return () => animation.stop()
  }, [comment, visible, motion])
  useEffect(() => {
    if (!comment) return
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false))
    return () => {show.remove(); hide.remove()}
  }, [comment])
  const content = <KeyboardAvoidingView style={{flex: 1, justifyContent: 'flex-end'}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.View style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim, opacity: comment ? motion : 1}]}><Pressable accessible={false} onPress={onDismiss} style={StyleSheet.absoluteFill} /></Animated.View>
      <Animated.View testID={testID} accessibilityViewIsModal onLayout={comment ? event => setSheetHeight(event.nativeEvent.layout.height) : undefined} style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}, comment && {maxHeight: '80%', flexShrink: 1, marginTop: 0, backgroundColor: C.background, paddingBottom: keyboardVisible ? 8 : inset.bottom, transform: [{translateY: motion.interpolate({inputRange: [0, 1], outputRange: [sheetHeight, 0]})}]}]}>{comment && !visible ? retained.current : children}</Animated.View>
    </KeyboardAvoidingView>
  if (inline) return (comment ? mounted || visible : visible) ? <View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, {zIndex: 5}]}>{content}</View> : null
  return <SourceSheetModal visible={visible} onDismiss={onDismiss}><View testID={testID} accessibilityViewIsModal style={[styles.readerSheet, {marginTop: inset.top + 36, paddingBottom: inset.bottom}]}>{children}</View></SourceSheetModal>
}

export function ReaderToolbar({visible, collection, youtube, starred, archived, t, onDismiss, onDidDismiss, onAction}: {visible: boolean; collection: boolean; youtube: boolean; starred: boolean; archived: boolean; t: Translate; onDismiss(): void; onDidDismiss?(): void; onAction(id: string): void}) {
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
  return <SourceSheetModal visible={visible} onDismiss={onDismiss} onDidDismiss={onDidDismiss}>
    <View style={[styles.toolbarSheet, {paddingBottom: inset.bottom + 24}]}><View style={styles.toolbarGrid}>{actions.map(action => <Pressable key={action.id} onPress={() => onAction(action.id)} style={styles.toolbarItem} accessibilityRole="button" testID={`reader-toolbar-${action.id}`}>
      <View style={styles.toolbarIcon}><SourceIcon name={action.icon} size={28} />{action.pro ? <SourceIcon name="ic_bottom_panel_pro" size={24} style={{position: 'absolute', right: -4, top: -4}} /> : null}</View>
      <SourceText style={[T.toolbarLabel, {marginTop: 8}]}>{action.label}</SourceText>
    </Pressable>)}</View></View>
  </SourceSheetModal>
}

export interface CommentMenuAnchor {markId: number; x: number; y: number}
export function CommentPanel({visible, mark, text, draft, reply, currentUserAvatar, hideProfiles, allowLine, allowComment, autoFocus, busy, menu, t, onMenu, onDraft, onClose, onCopy, onCopyComment, onHighlight, onReply, onDelete, canDelete, onSubmit}: {
  visible: boolean; mark: ReaderMarkItem | null; text: string; draft: string; reply: ReaderComment | null; currentUserAvatar: string;
  hideProfiles: boolean; allowLine: boolean; allowComment: boolean; autoFocus: boolean; busy: boolean; t: Translate;
  menu: CommentMenuAnchor | null; onMenu(value: CommentMenuAnchor | null): void;
  onDraft(value: string): void; onClose(): void; onCopy(): void; onCopyComment(comment: ReaderComment): void; onHighlight(): void; onReply(comment: ReaderComment | null): void;
  onDelete(comment: ReaderComment): void; canDelete(comment: ReaderComment): boolean; onSubmit(): void;
}) {
  const viewport = useWindowDimensions()
  const input = useRef<TextInput>(null)
  const [menuSize, setMenuSize] = useState({width: 0, height: 32})
  const focusConsumed = useRef(false)
  useEffect(() => {
    if (!visible) {focusConsumed.current = false; return}
    if (!autoFocus || !allowComment || focusConsumed.current) return
    const timer = setTimeout(() => {if (AppState.currentState == null || AppState.currentState === 'active') {focusConsumed.current = true; input.current?.focus()}}, 300)
    const subscription = AppState.addEventListener('change', state => {if (state !== 'active') {clearTimeout(timer); focusConsumed.current = true}})
    return () => {clearTimeout(timer); subscription.remove()}
  }, [visible, autoFocus, allowComment])
  const allComments = (comments: ReaderComment[]): ReaderComment[] => comments.flatMap(comment => [comment, ...allComments(comment.children)])
  const selectedComment = visible && menu ? allComments(mark?.comments ?? []).find(comment => comment.markId === menu.markId && !comment.isDeleted) : undefined
  useEffect(() => {if (menu && !selectedComment) onMenu(null)}, [menu, selectedComment, onMenu])
  const stroke = Boolean(mark?.stroke.length)
  const row = (comment: ReaderComment, child = false): React.ReactNode => <View key={comment.markId} style={child ? {marginLeft: 28} : undefined}>
    <Pressable testID={`reader-comment-${comment.markId}`} accessibilityRole="button" disabled={comment.isDeleted}
      onPress={() => {if (allowComment && !comment.isDeleted) {onReply(comment); input.current?.focus()}}}
      onLongPress={event => {if (!comment.isDeleted) onMenu({markId: comment.markId, x: event.nativeEvent.pageX, y: event.nativeEvent.pageY - event.nativeEvent.locationY})}}
      style={({pressed}) => [{paddingTop: child ? 8 : 20, paddingLeft: child ? 8 : 20, paddingBottom: 8, backgroundColor: pressed || selectedComment?.markId === comment.markId ? C.background : 'transparent'}]}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingRight: 20}}>
        {!hideProfiles ? <><SourceAvatar uri={comment.avatar} size={20} label={t('comment_panel_user_avatar')} /><SourceText numberOfLines={1} style={[styles.commentMeta, {marginLeft: 8, flexShrink: 1}]}>{comment.username || t('comment_panel_unknown_user')}</SourceText><View style={{height: 9, width: .5, backgroundColor: '#D8D8D8', marginHorizontal: 6}} /></> : null}
        <SourceText numberOfLines={1} style={styles.commentMeta}>{sourceDisplayTime(comment.createdAt) || comment.createdAt}</SourceText>
      </View>
      <SourceText style={{fontSize: 15, lineHeight: 24, color: C.text, marginTop: 8, paddingLeft: 28, paddingRight: 20}}>{comment.isDeleted ? t('comment_panel_deleted') : comment.comment}</SourceText>
    </Pressable>
    {comment.children.map(replyComment => row(replyComment, true))}
  </View>
  const action = (name: MobileAssetName, label: string, description: string, press: () => void, loading = false) => <Pressable accessibilityRole="button" accessibilityLabel={description} disabled={loading} accessibilityState={{disabled: loading}} onPress={press} hitSlop={8} style={({pressed}) => [styles.commentAction, {opacity: pressed ? .5 : 1}]}>
    {loading ? <ActivityIndicator size={18} color={C.secondaryText} /> : <SourceIcon name={name} size={20} />}<SourceText style={[T.helper, {color: loading ? '#33333366' : C.secondaryText}]}>{label}</SourceText>
  </Pressable>
  return <><ReaderSheet visible={visible} onDismiss={onClose} testID="reader-comment-panel" inline comment>
    <View style={{flexShrink: 1}}>
      <View style={{height: 60, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12, backgroundColor: C.readerBackground}}><IconAction name="ic_comment_panel_close" label={t('comment_panel_close')} onPress={onClose} /></View>
      <View style={{paddingHorizontal: 20, paddingBottom: 24, backgroundColor: C.readerBackground}}>
        <SourceText testID="reader-comment-quote" numberOfLines={2} ellipsizeMode="tail" style={{fontSize: 15, lineHeight: 24, textDecorationLine: stroke || mark?.comments.length ? 'underline' : 'none', textDecorationColor: '#CCB69A', textDecorationStyle: stroke ? 'solid' : 'dashed'}}>{text.replace(/\n{2,}/g, '\n')}</SourceText>
        <View style={{flexDirection: 'row', justifyContent: 'center', gap: 40, marginTop: 24}}>
          {action('ic_comment_panel_copy', t('comment_panel_copy'), t('comment_panel_copy_highlight_desc'), onCopy)}
          {stroke || allowLine ? action(stroke ? 'ic_comment_panel_highlighted' : 'ic_comment_panel_highlight', t(stroke ? 'comment_panel_remove_highlight' : 'comment_panel_highlight'), t(stroke ? 'comment_panel_remove_highlight_desc' : 'comment_panel_add_highlight_desc'), onHighlight, busy) : null}
        </View>
      </View>
      {mark?.comments.length ? <ScrollView testID="reader-comment-list" style={{flexGrow: 0, flexShrink: 1, backgroundColor: C.surface, borderTopWidth: .5, borderTopColor: '#33333314'}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={() => Keyboard.dismiss()} scrollEnabled={!selectedComment} contentContainerStyle={{paddingBottom: 52}}>{mark.comments.map(comment => row(comment))}</ScrollView> : null}
      {allowComment ? <View style={styles.commentEditor}>
        <View style={styles.commentInputContainer}>
          {!hideProfiles ? <View style={{paddingTop: 7}}><SourceAvatar uri={currentUserAvatar} size={24} label={t('comment_panel_current_user_avatar')} /></View> : null}
          <View style={{flex: 1}}>{reply ? <Pressable onPress={() => onReply(null)}><SourceText style={[T.helper, {color: C.link}]}>{t('comment_panel_reply_prefix')}{reply.username || t('comment_panel_unknown_user')}</SourceText></Pressable> : null}
            <TextInput ref={input} testID="reader-comment-input" multiline maxLength={1500} value={draft} onChangeText={onDraft} placeholder={t('comment_panel_placeholder')} placeholderTextColor="#BBBBBB" selectionColor={C.textSelection} style={styles.commentInput} />
          </View>
        </View><Pressable testID="reader-comment-send" accessibilityRole="button" disabled={!draft.trim() || busy} accessibilityState={{disabled: !draft.trim() || busy}} onPress={onSubmit} style={({pressed}) => [styles.commentSend, {backgroundColor: draft.trim() ? C.accent : '#99999929', opacity: pressed && draft.trim() ? .7 : 1}]}><SourceText style={{fontSize: 16, lineHeight: 26, color: draft.trim() ? C.surface : C.mutedText}}>{t('comment_panel_send')}</SourceText></Pressable>
      </View> : null}
    </View>
  </ReaderSheet>
    {selectedComment && menu ? <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => onMenu(null)}>
      <Pressable testID="reader-comment-menu-dismiss" accessible={false} style={StyleSheet.absoluteFill} onPress={() => onMenu(null)} />
      <View testID="reader-comment-menu" accessibilityViewIsModal onLayout={event => setMenuSize(event.nativeEvent.layout)} style={[styles.commentMenu, {left: Math.max(0, Math.min(menu.x - menuSize.width / 2, viewport.width - menuSize.width)), top: Math.max(0, menu.y - menuSize.height - 8)}]}>
        <Pressable testID="reader-comment-copy" accessibilityRole="button" onPress={() => {onMenu(null); onCopyComment(selectedComment)}} style={({pressed}) => [styles.commentMenuItem, {backgroundColor: pressed ? C.selectionMenuPressed : 'transparent'}]}><SourceIcon name="ic_menu_action_copy" size={20} /><SourceText style={styles.commentMenuText}>{t('comment_panel_copy')}</SourceText></Pressable>
        {canDelete(selectedComment) ? <Pressable testID="reader-comment-delete" accessibilityRole="button" onPress={() => {onMenu(null); onDelete(selectedComment)}} style={({pressed}) => [styles.commentMenuItem, {backgroundColor: pressed ? C.selectionMenuPressed : 'transparent'}]}><SourceIcon name="ic_comment_panel_delete" size={20} /><SourceText style={styles.commentMenuText}>{t('comment_panel_delete')}</SourceText></Pressable> : null}
      </View>
    </Modal> : null}
  </>
}

export function OutlineSheet({status, toolbarVisible, markdown, pending, busy, error, position, t, onClose, onCollapse, onExpand, onRetry, onLink, onPosition}: {status: OutlineStatus; toolbarVisible: boolean; markdown: string; pending: boolean; busy: boolean; error: string | null; position: number; t: Translate; onClose(): void; onCollapse(): void; onExpand(): void; onRetry(): void; onLink(href: string): void; onPosition(position: number): void}) {
  const viewport = useWindowDimensions(), inset = useSafeAreaInsets()
  const previous = useRef<OutlineStatus>('hidden')
  const [contentReady, setContentReady] = useState(false)
  const values = useRef({background: new Animated.Value(0), expanded: new Animated.Value(0), slide: new Animated.Value(1), collapsed: new Animated.Value(0), morph: new Animated.Value(0), morphAlpha: new Animated.Value(0)}).current
  const toolbarOffset = useRef(new Animated.Value(toolbarVisible ? 0 : 150)).current
  useEffect(() => {
    const animation = Animated.timing(toolbarOffset, {toValue: toolbarVisible ? 0 : 150, duration: 300, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true})
    animation.start(); return () => animation.stop()
  }, [toolbarVisible, toolbarOffset])
  useEffect(() => {
    const motion = outlineMotion(previous.current, status)
    previous.current = status
    if (status === 'expanded') setContentReady(true)
    // Collapsed opacity shares its native AnimatedProps graph with toolbarOffset.
    const animation = Animated.parallel((Object.keys(values) as (keyof typeof values)[]).map(key => Animated.sequence(motion[key].map(step => Animated.timing(values[key], {...step, easing: step.linear ? Easing.linear : Easing.bezier(.4, 0, .2, 1), useNativeDriver: key === 'collapsed'})))))
    animation.start()
    return () => animation.stop()
  }, [status, values])
  if (status === 'none') return null
  const interpolate = (value: Animated.Value, from: number, to: number) => value.interpolate({inputRange: [0, 1], outputRange: [from, to]})
  const height = viewport.height - inset.top - 36, bottom = inset.bottom + 24
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, {zIndex: 4}]}>
    <Animated.View pointerEvents={status === 'expanded' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, {backgroundColor: '#000000', opacity: values.background}]}><Pressable testID="reader-outline-dismiss" accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} /></Animated.View>
    <Animated.View testID="reader-outline-morph" pointerEvents="none" style={{position: 'absolute', alignSelf: 'center', backgroundColor: C.surface, opacity: values.morphAlpha, width: interpolate(values.morph, 50, viewport.width), height: interpolate(values.morph, 50, height), bottom: interpolate(values.morph, bottom, 0), borderTopLeftRadius: interpolate(values.morph, 25, 20), borderTopRightRadius: interpolate(values.morph, 25, 20), borderBottomLeftRadius: interpolate(values.morph, 25, 0), borderBottomRightRadius: interpolate(values.morph, 25, 0), transform: [{translateX: interpolate(values.morph, -87, 0)}]}} />
    <Animated.View testID="reader-outline-panel" pointerEvents={status === 'expanded' ? 'auto' : 'none'} accessibilityViewIsModal={status === 'expanded'} accessibilityElementsHidden={status !== 'expanded'} importantForAccessibility={status === 'expanded' ? 'auto' : 'no-hide-descendants'} style={[styles.outlinePanel, {height, paddingBottom: inset.bottom, opacity: values.expanded, transform: [{translateY: interpolate(values.slide, 0, viewport.height)}]}]}>
      <View style={{flex: 1, paddingTop: 32}}>
        {error ? <View style={styles.center}><SourceText style={{fontSize: 16, fontWeight: '500', color: '#FF5252'}}>{t('outline_error')}</SourceText><SourceText style={{fontSize: 12, color: C.mutedText, marginTop: 8}}>{error}</SourceText><TextAction label={t('rss_retry')} onPress={onRetry} /></View> : pending && busy ? <View style={styles.center}><ActivityIndicator color={C.bodyText} /><SourceText style={[T.helper, {marginTop: 12}]}>{t('outline_summarizing')}</SourceText></View> : contentReady ?
          <MarkdownView markdown={markdown || t('outline_empty')} initialPosition={position} onLink={onLink} onPosition={onPosition} /> : null}
        {busy && !pending ? <View style={{paddingVertical: 20}}><ActivityIndicator color={C.bodyText} /></View> : null}
      </View>
      <View testID="reader-outline-footer" style={{height: 55, flexDirection: 'row', alignItems: 'center'}}>
        <Pressable testID="reader-outline-minimize" accessibilityRole="button" onPress={onCollapse} style={({pressed}) => [styles.outlineFooterAction, {opacity: pressed ? .5 : 1}]}><SourceIcon name="ic_outline_dialog_shrink" size={24} style={{tintColor: '#666666'}} /><SourceText style={[T.helper, {color: C.secondaryText}]}>{t('outline_minimize')}</SourceText></Pressable>
        <View style={{width: 1, height: 16, backgroundColor: '#33333314'}} />
        <Pressable testID="reader-outline-close" accessibilityRole="button" onPress={onClose} style={({pressed}) => [styles.outlineFooterAction, {opacity: pressed ? .5 : 1}]}><SourceIcon name="ic_outline_dialog_close" size={24} style={{tintColor: '#666666'}} /><SourceText style={[T.helper, {color: C.secondaryText}]}>{t('btn_close')}</SourceText></Pressable>
      </View>
    </Animated.View>
    <Animated.View pointerEvents={status === 'collapsed' && toolbarVisible ? 'auto' : 'none'} accessibilityElementsHidden={status !== 'collapsed' || !toolbarVisible} importantForAccessibility={status === 'collapsed' && toolbarVisible ? 'auto' : 'no-hide-descendants'} style={[styles.floatingCircle, {position: 'absolute', alignSelf: 'center', bottom, opacity: values.collapsed, transform: [{translateX: -87}, {translateY: toolbarOffset}]}]}><IconAction name="ic_outline_collapsed" label={t('outline_expand')} size={20} onPress={onExpand} testID="reader-outline-expand" /></Animated.View>
  </View>
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
  floating: {position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 12}, floatingPill: {height: 50, borderRadius: 25, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.surface, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8}, floatingCircle: {width: 50, height: 50, borderRadius: 25, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 40, shadowOffset: {width: 0, height: 10}, elevation: 8},
  readerSheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.readerBackground, overflow: 'hidden', maxHeight: '96%'},
  toolbarSheet: {backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24, paddingHorizontal: 12}, toolbarGrid: {flexDirection: 'row', flexWrap: 'wrap', rowGap: 24}, toolbarItem: {width: '25%', alignItems: 'center'}, toolbarIcon: {width: 56, height: 56, borderRadius: 16, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center'},
  commentMeta: {fontSize: 12, lineHeight: 16.5, color: C.mutedText}, commentAction: {flexDirection: 'row', alignItems: 'center', gap: 5},
  commentEditor: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, backgroundColor: C.background}, commentInputContainer: {flex: 1, flexDirection: 'row', gap: 8, minHeight: 38, borderRadius: 8, backgroundColor: C.surface, paddingHorizontal: 8}, commentInput: {paddingVertical: 9, paddingHorizontal: 0, fontSize: 14, lineHeight: 20, minHeight: 38, maxHeight: 100, color: C.bodyText, includeFontPadding: false},
  commentSend: {height: 38, borderRadius: 8, paddingHorizontal: 11.5, alignItems: 'center', justifyContent: 'center'}, commentMenu: {position: 'absolute', flexDirection: 'row', alignItems: 'center', backgroundColor: C.selectionMenu, borderRadius: 12, paddingHorizontal: 6}, commentMenuItem: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 1, paddingLeft: 6, paddingRight: 10, borderRadius: 6}, commentMenuText: {fontSize: 15, lineHeight: 21, fontWeight: '500', color: C.selectionText},
  outlinePanel: {position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.surface, overflow: 'hidden'}, outlineFooterAction: {flex: 1, height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20}, cue: {padding: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 6}, cueTime: {fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#2F9E5E', backgroundColor: '#8AD8A829', borderWidth: 1, borderColor: '#8AD8A880', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3}, closeRow: {height: 55, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6},
})
