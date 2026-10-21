import React, {useRef} from 'react';
import {Pressable, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {SourceText} from '../components/SourceUI';
import type {TagRecord} from '../data/repositories/types';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';
import {tagSuggestions} from './query';
export function SearchInput({text, selected, tags, onText, onTags, onSubmit, busy, t}: {
  text: string; selected: string[]; tags: TagRecord[]; onText(text: string): void; onTags(ids: string[]): void; onSubmit(): void; busy: boolean; t: MobileContextValue['t'];
}) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const suggestions = tagSuggestions(text, tags), suggested = /(?:^|\s)#[^#]*$/.test(text);
  function toggle(tag: TagRecord) {
    if (suggested) onText(text.replace(/(?:^|\s)#[^#]*$/, '').trim());
    onTags(selected.includes(tag.id) ? selected.filter(id => id !== tag.id) : [...selected, tag.id]); input.current?.focus();
  }
  return <View>
    <View style={styles.top}>
      <View style={styles.inputBox}>
        {selected.map(id => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${t('search_remove_tag')} ${tags.find(tag => tag.id === id)?.tag_name ?? id}`} onPress={() => onTags(selected.filter(value => value !== id))} style={styles.chip}><SourceText style={styles.chipText}>#{tags.find(tag => tag.id === id)?.tag_name ?? t('search_unknown_tag')} ×</SourceText></Pressable>)}
        <TextInput ref={input} autoFocus accessibilityLabel={t('search_input')} placeholder={t('search_hint')} placeholderTextColor={C.mutedText} value={text} onChangeText={onText} autoCorrect={false} autoCapitalize="none" returnKeyType="search" maxLength={1000}
          onSubmitEditing={event => {if (!(event.nativeEvent as typeof event.nativeEvent & {isComposing?: boolean}).isComposing) onSubmit();}}
          onKeyPress={event => {if (event.nativeEvent.key === 'Backspace' && !text && selected.length) onTags(selected.slice(0, -1));}}
          style={styles.input}/>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{busy}} disabled={busy} onPress={onSubmit} style={styles.submit}><SourceText style={{color: C.accent, fontSize: 16}}>{t(busy ? 'search_searching' : 'search_action')}</SourceText></Pressable>
    </View>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {(suggested ? suggestions : tags.filter(tag => !['0', 'false'].includes(String(tag.display)))).map(tag => <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityState={{checked: selected.includes(tag.id)}} onPress={() => toggle(tag)} style={[styles.railTag, selected.includes(tag.id) && {backgroundColor: C.selectedOverlay}]}><SourceText style={{fontSize: 14, color: C.bodyText}}>#{tag.tag_name}</SourceText></Pressable>)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({top: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingVertical: 8}, inputBox: {flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 10, minHeight: 44, gap: 4}, input: {flexGrow: 1, minWidth: 100, minHeight: 44, fontSize: 16, color: C.text, paddingVertical: 8}, chip: {minHeight: 36, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 8, backgroundColor: C.selectedOverlay}, chipText: {color: C.bodyText, fontSize: 14}, submit: {minWidth: 44, minHeight: 44, justifyContent: 'center'}, rail: {paddingHorizontal: 16, paddingVertical: 8, gap: 8}, railTag: {minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, justifyContent: 'center'}});
