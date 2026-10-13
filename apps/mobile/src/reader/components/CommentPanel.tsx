import React, {useEffect, useRef, useState} from 'react'
import {ActivityIndicator, AppState, Keyboard, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions} from 'react-native'
import type {MobileAssetName} from '../../../assets'
import {SourceAvatar, SourceIcon, SourceText} from '../../components'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {sourceDisplayTime} from '../model'
import type {ReaderComment, ReaderMarkItem} from '../types'
import type {Translate} from '../state/types'
import {ReaderSheet} from './ReaderSheet'
import {IconAction} from './IconAction'

export interface CommentMenuAnchor {markId: number; x: number; y: number}
export function CommentPanel({visible, mark, text, draft, reply, currentUserAvatar, hideProfiles, allowLine, allowComment, autoFocus, busy, menu, t, onMenu, onDraft, onClose, onCopy, onCopyComment, onHighlight, onReply, onDelete, canDelete, onSubmit}: {
  visible: boolean; mark: ReaderMarkItem | null; text: string; draft: string; reply: ReaderComment | null; currentUserAvatar: string;
  hideProfiles: boolean; allowLine: boolean; allowComment: boolean; autoFocus: boolean; busy: boolean; t: Translate;
  menu: CommentMenuAnchor | null; onMenu(value: CommentMenuAnchor | null): void;
  onDraft(value: string): void; onClose(): void; onCopy(): void; onCopyComment(comment: ReaderComment): void; onHighlight(): void; onReply(comment: ReaderComment | null): void;
  onDelete(comment: ReaderComment): void; canDelete(comment: ReaderComment): boolean; onSubmit(): void;
}) {
  const viewport = useWindowDimensions(), input = useRef<TextInput>(null)
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
    </Pressable>{comment.children.map(replyComment => row(replyComment, true))}
  </View>
  const action = (name: MobileAssetName, label: string, description: string, press: () => void, loading = false) => <Pressable accessibilityRole="button" accessibilityLabel={description} disabled={loading} accessibilityState={{disabled: loading}} onPress={press} hitSlop={8} style={({pressed}) => [styles.commentAction, {opacity: pressed ? .5 : 1}]}>
    {loading ? <ActivityIndicator size={18} color={C.secondaryText} /> : <SourceIcon name={name} size={20} />}<SourceText style={[T.helper, {color: loading ? '#33333366' : C.secondaryText}]}>{label}</SourceText>
  </Pressable>
  return <><ReaderSheet visible={visible} onDismiss={onClose} testID="reader-comment-panel" inline comment>
    <View style={{flexShrink: 1}}>
      <View style={{height: 60, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 12, backgroundColor: C.readerBackground}}><IconAction name="ic_comment_panel_close" label={t('comment_panel_close')} onPress={onClose} /></View>
      <View style={{paddingHorizontal: 20, paddingBottom: 24, backgroundColor: C.readerBackground}}>
        <SourceText testID="reader-comment-quote" numberOfLines={2} ellipsizeMode="tail" style={{fontSize: 15, lineHeight: 24, textDecorationLine: stroke || mark?.comments.length ? 'underline' : 'none', textDecorationColor: '#CCB69A', textDecorationStyle: stroke ? 'solid' : 'dashed'}}>{mark?.source.some(source => source.type === 'pdf') ? text : text.replace(/\n{2,}/g, '\n')}</SourceText>
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
const styles = StyleSheet.create({
  commentMeta: {fontSize: 12, lineHeight: 16.5, color: C.mutedText}, commentAction: {flexDirection: 'row', alignItems: 'center', gap: 5},
  commentEditor: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 8, backgroundColor: C.background}, commentInputContainer: {flex: 1, flexDirection: 'row', gap: 8, minHeight: 38, borderRadius: 8, backgroundColor: C.surface, paddingHorizontal: 8}, commentInput: {paddingVertical: 9, paddingHorizontal: 0, fontSize: 14, lineHeight: 20, minHeight: 38, maxHeight: 100, color: C.bodyText, includeFontPadding: false},
  commentSend: {height: 38, borderRadius: 8, paddingHorizontal: 11.5, alignItems: 'center', justifyContent: 'center'}, commentMenu: {position: 'absolute', flexDirection: 'row', alignItems: 'center', backgroundColor: C.selectionMenu, borderRadius: 12, paddingHorizontal: 6}, commentMenuItem: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 1, paddingLeft: 6, paddingRight: 10, borderRadius: 6}, commentMenuText: {fontSize: 15, lineHeight: 21, fontWeight: '500', color: C.selectionText},
})
