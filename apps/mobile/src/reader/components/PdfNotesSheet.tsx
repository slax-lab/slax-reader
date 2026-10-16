import React from 'react'
import {Pressable, ScrollView, StyleSheet, View} from 'react-native'
import {SourceText, TextAction} from '../../components'
import {mobileColors as C, mobileTypography as T} from '../../theme'
import {selectionForMark} from '../model'
import type {ReaderMarkItem} from '../types'
import type {Translate} from '../state/types'

export function PdfNotesSheet({visible, marks, bottom, t, onClose, onSelect}: {
  visible: boolean; marks: ReaderMarkItem[]; bottom: number; t: Translate; onClose(): void; onSelect(mark: ReaderMarkItem): void
}) {
  if (!visible) return null
  return <View style={[StyleSheet.absoluteFill, {justifyContent: 'flex-end', zIndex: 5}]}>
    <Pressable accessibilityLabel={t('btn_close')} onPress={onClose} style={[StyleSheet.absoluteFill, {backgroundColor: C.scrim}]} />
    <View accessibilityViewIsModal testID="reader-pdf-note-list" style={{maxHeight: '70%', backgroundColor: C.surface, padding: 20, paddingBottom: bottom + 20}}>
      <TextAction label={t('btn_close')} onPress={onClose} />
      <ScrollView>{marks.map(mark => <Pressable key={mark.id} accessibilityRole="button" style={{paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border}} onPress={() => onSelect(mark)}>
        <SourceText style={[T.helper, {color: C.mutedText}]}>{t('pdf_page')} {mark.source[0]?.type === 'pdf' ? mark.source[0].page : ''}</SourceText>
        <SourceText numberOfLines={3}>{selectionForMark(mark, '').text}</SourceText>
      </Pressable>)}</ScrollView>
    </View>
  </View>
}
