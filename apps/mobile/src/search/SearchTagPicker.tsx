import React, {useEffect, useState} from 'react';
import {Keyboard, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SourceText} from '../components/SourceUI';
import {SourceSheetModal} from '../components/SourceSheetModal';
import type {TagRecord} from '../data/repositories/types';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';
import {SearchCheck} from './SearchSymbols';

export function SearchTagPicker({visible, tags, selected, onChange, onDismiss, t}: {
  visible: boolean; tags: TagRecord[]; selected: string[]; onChange(ids: string[]): void; onDismiss(): void; t: MobileContextValue['t'];
}) {
  const [filter, setFilter] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const {height} = useWindowDimensions(), insets = useSafeAreaInsets();
  useEffect(() => {if (!visible) setFilter('');}, [visible]);
  useEffect(() => {
    if (!visible) {setKeyboardHeight(0); return;}
    const update = (frame?: {screenY: number} | null) => setKeyboardHeight(frame ? Math.max(0, height - frame.screenY) : 0);
    update(Keyboard.metrics());
    const moving = Keyboard.addListener('keyboardWillChangeFrame', event => update(event.endCoordinates));
    const shown = Keyboard.addListener('keyboardDidShow', event => update(event.endCoordinates));
    const hidden = Keyboard.addListener('keyboardDidHide', () => update());
    return () => {moving.remove(); shown.remove(); hidden.remove();};
  }, [visible, height]);
  // An explicit viewport-derived height avoids percentage sizing through multiple
  // intrinsic-height wrappers. Only the list scrolls; Done and reset stay reachable.
  const panelHeight = Math.max(0, Math.min(Math.round(height * 0.72), height - insets.top - keyboardHeight - 12));
  const choices = tags.filter(tag => (selected.includes(tag.id) || !['0', 'false'].includes(String(tag.display))) && tag.tag_name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const dismiss = () => {Keyboard.dismiss(); onDismiss();};
  return <SourceSheetModal visible={visible} onDismiss={dismiss}>
    <View testID="search-tag-panel" style={[styles.panel, {height: panelHeight, paddingBottom: keyboardHeight ? 12 : insets.bottom + 12}]}>
      <View accessible={false} style={styles.handle}/>
      <View style={styles.header}>
        <SourceText accessibilityRole="header" style={styles.title}>{t('search_tags')}</SourceText>
        <Pressable accessibilityRole="button" accessibilityLabel={t('search_tags_done')} onPress={dismiss} style={styles.action}>
          <SourceText style={styles.done}>{t('search_tags_done')}</SourceText>
        </Pressable>
      </View>
      <SourceText style={styles.hint}>{t('search_tags_hint')}</SourceText>
      <TextInput accessibilityLabel={t('search_find_tag')} placeholder={t('search_find_tag')} placeholderTextColor={C.searchSecondaryText}
        value={filter} onChangeText={setFilter} autoCorrect={false} autoCapitalize="none" style={styles.input}/>
      <ScrollView testID="search-tag-options" style={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.listContent}>
        {choices.map(tag => {
          const checked = selected.includes(tag.id);
          return <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityLabel={tag.tag_name} accessibilityState={{checked}}
            onPress={() => onChange(checked ? selected.filter(id => id !== tag.id) : [...selected, tag.id])}
            style={({pressed}) => [styles.row, pressed && styles.pressed]}>
            <SourceText accessible={false} style={styles.hash}>#</SourceText>
            <SourceText style={[styles.name, checked && styles.selectedName]}>{tag.tag_name}</SourceText>
            <View style={[styles.check, checked && styles.checked]}>{checked ? <SearchCheck/> : null}</View>
          </Pressable>;
        })}
        {!choices.length ? <SourceText style={styles.empty}>{t('search_tags_empty')}</SourceText> : null}
      </ScrollView>
      {selected.length ? <Pressable accessibilityRole="button" accessibilityLabel={t('search_reset_tags')} onPress={() => onChange([])} style={styles.reset}>
        <SourceText style={styles.resetText}>{t('search_reset_tags')}</SourceText>
      </Pressable> : null}
    </View>
  </SourceSheetModal>;
}

const styles = StyleSheet.create({
  panel: {backgroundColor: C.readerBackground, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, overflow: 'hidden'},
  handle: {width: 32, height: 4, borderRadius: 2, backgroundColor: C.buttonBorder, alignSelf: 'center', marginTop: 10, marginBottom: 10},
  header: {flexDirection: 'row', alignItems: 'center', gap: 12},
  title: {flex: 1, fontSize: 21, lineHeight: 29, fontWeight: '600', color: C.text},
  action: {minHeight: 44, minWidth: 44, paddingLeft: 12, alignItems: 'center', justifyContent: 'center'},
  done: {fontSize: 15, lineHeight: 22, fontWeight: '600', color: C.searchActionText},
  hint: {fontSize: 13, lineHeight: 20, color: C.searchSecondaryText, marginTop: 2, marginBottom: 16},
  input: {minHeight: 46, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: C.background, color: C.text, fontSize: 15, marginBottom: 12},
  list: {flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border},
  listContent: {paddingBottom: 8},
  row: {minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border},
  hash: {fontSize: 19, lineHeight: 25, color: C.searchSecondaryText, width: 24, textAlign: 'center'},
  name: {flex: 1, fontSize: 16, lineHeight: 23, color: C.text},
  selectedName: {fontWeight: '500', color: C.searchActionText},
  check: {width: 22, height: 22, borderRadius: 7, borderWidth: 1, borderColor: C.buttonBorder, alignItems: 'center', justifyContent: 'center'},
  checked: {backgroundColor: C.searchSelection, borderColor: C.searchActionText},
  empty: {fontSize: 14, lineHeight: 21, color: C.searchSecondaryText, paddingVertical: 24},
  reset: {minHeight: 48, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border},
  resetText: {fontSize: 14, lineHeight: 21, color: C.searchSecondaryText},
  pressed: {backgroundColor: C.pressedOverlay},
});
