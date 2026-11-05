import React from 'react'
import {Pressable, StyleSheet, TextInput, View} from 'react-native'
import {SourceButton, SourceDialog, SourceIcon, SourceText, TextAction} from '../../components'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import type {ReaderOverlay, Translate} from '../state/types'

interface DialogProps {
  active: boolean; overlay: ReaderOverlay; t: Translate; closeOverlay(): void
  title: {draft: string; change(value: string): void; confirm(): void}
  deleteBookmark(): void
  external: {id: number; visible: boolean; doNotAlert: boolean; cancel(): void; didDismiss(): void; confirm(): void; toggleAlert(): void}
  discard: {visible: boolean; cancel(): void; confirm(): void}
  comment: {visible: boolean; cancel(): void; confirm(): void}
  error: {message: string | null; close(): void}
}
export function ReaderDialogs({active, overlay, t, closeOverlay, title, deleteBookmark, external, discard, comment, error}: DialogProps) {
  return <>
    <SourceDialog testID="reader-edit-title-dialog" compact visible={active && overlay === 'edit'} onDismiss={closeOverlay}>
      <View style={styles.header}>
        <SourceText accessibilityRole="header" style={[T.dialogTitle, {fontWeight: '500'}]}>{t('edit_title_dialog_title')}</SourceText>
        <Pressable accessibilityRole="button" accessibilityLabel={t('btn_close')} hitSlop={10} onPress={closeOverlay}><SourceIcon name="ic_xs_dialog_close" /></Pressable>
      </View>
      <TextInput selectionColor={C.accent} cursorColor={C.accent} accessibilityLabel={t('edit_title_dialog_title')} value={title.draft} onChangeText={title.change} multiline autoFocus style={styles.textInput} />
      <SourceButton label={t('btn_confirm')} disabled={!title.draft.trim()} onPress={title.confirm} style={{marginTop: 24}} />
    </SourceDialog>
    <SourceDialog visible={active && overlay === 'delete'} onDismiss={closeOverlay} title={t('bookmark_delete_confirm_title')} actions={<>
      <TextAction label={t('btn_cancel')} onPress={closeOverlay} /><TextAction color={C.danger} label={t('btn_confirm')} onPress={deleteBookmark} />
    </>}><SourceText>{t('bookmark_delete_confirm_message')}</SourceText></SourceDialog>
    <SourceDialog visible={active && overlay === 'subscription'} onDismiss={closeOverlay} title={t('subscription_required_title')} actions={<TextAction label={t('subscription_required_btn_ok')} onPress={closeOverlay} />}><SourceText>{t('subscription_required_message')}</SourceText></SourceDialog>
    <SourceDialog key={`external-link-${external.id}`} visible={active && external.visible} onDismiss={external.cancel} onDidDismiss={external.didDismiss} title={t('external_link_alert_title')} actions={<>
      <TextAction label={t('btn_cancel')} onPress={external.cancel} /><TextAction label={t('btn_confirm')} onPress={external.confirm} />
    </>}><SourceText>{t('external_link_alert_message')}</SourceText><Pressable accessibilityRole="checkbox" accessibilityState={{checked: external.doNotAlert}} onPress={external.toggleAlert} style={{flexDirection: 'row', alignItems: 'center', marginTop: 12}}>
      <SourceIcon name={external.doNotAlert ? 'ic_agree_enable' : 'ic_agree_disable'} size={16} /><SourceText style={T.helper}>{t('external_link_do_not_alert')}</SourceText>
    </Pressable></SourceDialog>
    <SourceDialog visible={active && discard.visible} onDismiss={discard.cancel} title={t('comment_panel_discard_title')} actions={<>
      <TextAction label={t('comment_panel_discard_cancel')} onPress={discard.cancel} /><TextAction label={t('comment_panel_discard_confirm')} onPress={discard.confirm} />
    </>}><SourceText>{t('comment_panel_discard_message')}</SourceText></SourceDialog>
    <SourceDialog visible={active && comment.visible} onDismiss={comment.cancel} title={t('comment_panel_confirm_delete')} actions={<>
      <TextAction label={t('btn_cancel')} onPress={comment.cancel} /><TextAction label={t('comment_panel_delete')} color={C.danger} onPress={comment.confirm} />
    </>} />
    <SourceDialog visible={active && error.message !== null} onDismiss={error.close} title={t('load_bookmark_content_error')} actions={<TextAction label={t('btn_ok')} onPress={error.close} />}><SourceText>{error.message}</SourceText></SourceDialog>
  </>
}
const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 25, gap: 12},
  textInput: {borderWidth: 1, borderColor: C.border, borderRadius: 8, minHeight: 50, maxHeight: 200, paddingHorizontal: 12, paddingVertical: 10, marginTop: 25, ...T.body, color: C.bodyText, includeFontPadding: false},
})
