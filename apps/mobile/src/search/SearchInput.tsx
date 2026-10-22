import React, {useRef, useState} from 'react';
import {ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View} from 'react-native';
import {SourceText} from '../components/SourceUI';
import {SearchGlyph} from '../components/SearchGlyph';
import type {TagRecord} from '../data/repositories/types';
import type {MobileContextValue} from '../runtime';
import {mobileColors as C} from '../theme';
import {SearchChevron, SearchClose, SearchCheck} from './SearchSymbols';
import {SearchTagPicker} from './SearchTagPicker';
import {tagSuggestions} from './query';

export function SearchInput({text, selected, tags, sourceLabel, sourceKind, invalid, onText, onTags, onClearSource, onSubmit, busy, searching = busy, t}: {
  text: string; selected: string[]; tags: TagRecord[]; sourceLabel?: string; sourceKind?: 'collection' | 'rss'; invalid?: boolean;
  onText(text: string): void; onTags(ids: string[]): void; onClearSource?(): void; onSubmit(): void;
  busy: boolean; searching?: boolean; t: MobileContextValue['t'];
}) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [pickingTags, setPickingTags] = useState(false);
  const suggested = /(?:^|\s)#[^#]*$/.test(text);
  const suggestions = suggested ? tagSuggestions(text, tags).slice(0, 4) : [];
  const hasFilters = Boolean(sourceLabel || selected.length);
  const selectedNames = selected.map(id => tags.find(tag => tag.id === id)?.tag_name ?? t('search_unknown_tag'));
  function chooseSuggestion(tag: TagRecord) {
    onText(text.replace(/(?:^|\s)#[^#]*$/, '').trim());
    if (!selected.includes(tag.id)) onTags([...selected, tag.id]);
    input.current?.focus();
  }
  function openTags() {Keyboard.dismiss(); setPickingTags(true);}
  function changePickerTags(ids: string[]) {
    if (suggested && ids.some(id => !selected.includes(id))) onText(text.replace(/(?:^|\s)#[^#]*$/, '').trim());
    onTags(ids);
  }
  return <View style={styles.container}>
    <View style={styles.top}>
      <View style={styles.inputBox}>
        <SearchGlyph/>
        <TextInput ref={input} testID="search-keyword" autoFocus accessibilityLabel={t('search_input')}
          placeholder={sourceLabel ? t('search_scoped_hint') : t('search_hint')} placeholderTextColor={C.searchSecondaryText}
          value={text} onChangeText={onText} autoCorrect={false} autoCapitalize="none" returnKeyType="search" maxLength={1000}
          onSubmitEditing={event => {if (!(event.nativeEvent as typeof event.nativeEvent & {isComposing?: boolean}).isComposing) onSubmit();}}
          onKeyPress={event => {
            if (event.nativeEvent.key === 'Backspace' && !text) {
              if (selected.length) onTags(selected.slice(0, -1)); else if (sourceLabel) onClearSource?.();
            }
          }} style={styles.input}/>
        {text || hasFilters ? <Pressable accessibilityRole="button" accessibilityLabel={t('search_clear')}
          onPress={() => {onText(''); onTags([]); onClearSource?.(); input.current?.focus();}} style={styles.clear}>
          <SearchClose/>
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t('search_action')} accessibilityState={{busy, disabled: busy}}
          disabled={busy} onPress={onSubmit} style={({pressed}) => [styles.submit, pressed && styles.pressed]}>
          {searching ? <ActivityIndicator testID="search-submit-loading" size="small" color={C.searchActionText}/> :
            <SourceText style={styles.submitText}>{t('search_action')}</SourceText>}
        </Pressable>
      </View>
    </View>
    <View style={styles.filters}>
      {sourceLabel ? <View style={styles.sourceScope}>
        <SourceText style={styles.scopeKind}>{sourceKind === 'rss' ? 'RSS' : 'Collection'}</SourceText>
        <SourceText numberOfLines={2} style={styles.sourceName}>{sourceLabel}</SourceText>
        <Pressable testID="search-source-chip" accessibilityRole="button" accessibilityLabel={`${t('search_remove_source')} ${sourceLabel}`}
          onPress={onClearSource} style={({pressed}) => [styles.filterClear, pressed && styles.pressed]}><SearchClose/></Pressable>
      </View> : <>
        <SourceText style={styles.scopeLabel}>{t(selected.length ? 'search_articles' : 'search_all_material')}</SourceText>
        {tags.length > 0 ? <Pressable testID="search-tags-toggle" accessibilityRole="button" accessibilityLabel={t('search_tags')}
          accessibilityState={{expanded: pickingTags}} onPress={openTags} style={({pressed}) => [styles.tagToggle, pressed && styles.pressed]}>
          <SourceText style={[styles.tagToggleText, selected.length > 0 && styles.selectedText]}>{t('search_tags')}{selected.length ? ` · ${selected.length}` : ''}</SourceText>
          <SearchChevron down/>
        </Pressable> : null}
      </>}
    </View>
    {!sourceLabel && selected.length > 0 ? <View style={styles.selectionSummary}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('search_tags')}: ${selectedNames.join(', ')}`} onPress={openTags} style={styles.summaryAction}>
        <SourceText numberOfLines={2} style={styles.summaryText}>{selectedNames.map(name => `#${name}`).join('  ·  ')}</SourceText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('search_reset_tags')} onPress={() => onTags([])} style={styles.filterClear}><SearchClose/></Pressable>
    </View> : null}
    {suggested ? <View style={styles.suggestions}>
      {suggestions.map(tag => <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`${t('search_choose_tag')} ${tag.tag_name}`}
        accessibilityState={{selected: selected.includes(tag.id)}} onPress={() => chooseSuggestion(tag)} style={({pressed}) => [styles.suggestion, pressed && styles.pressed]}>
        <SourceText style={styles.suggestionHash}>#</SourceText><SourceText style={styles.suggestionName}>{tag.tag_name}</SourceText>
        {selected.includes(tag.id) ? <SearchCheck/> : null}
      </Pressable>)}
      {!suggestions.length ? <SourceText style={styles.suggestionHint}>{t('search_tags_empty')}</SourceText> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t('search_all_tags')} onPress={openTags} style={styles.allTags}>
        <SourceText style={styles.allTagsText}>{t('search_all_tags')}</SourceText><SearchChevron/>
      </Pressable>
    </View> : null}
    {invalid ? <SourceText accessibilityRole="alert" style={styles.error}>{t('search_unknown_tag')}</SourceText> : null}
    <SearchTagPicker visible={pickingTags} tags={tags} selected={selected} onChange={changePickerTags} onDismiss={() => setPickingTags(false)} t={t}/>
  </View>;
}

const styles = StyleSheet.create({
  container: {backgroundColor: C.readerBackground, paddingTop: 4, paddingBottom: 0},
  top: {paddingHorizontal: 20},
  inputBox: {flexDirection: 'row', alignItems: 'center', backgroundColor: C.background, borderRadius: 14, paddingLeft: 12, minHeight: 50},
  input: {flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: C.text, paddingVertical: 12, paddingHorizontal: 8},
  clear: {width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexShrink: 0},
  submit: {minWidth: 56, minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center'},
  submitText: {fontSize: 14, lineHeight: 21, fontWeight: '600', color: C.searchActionText},
  filters: {minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border},
  scopeLabel: {flex: 1, fontSize: 13, lineHeight: 20, color: C.searchSecondaryText},
  tagToggle: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12},
  tagToggleText: {fontSize: 13, lineHeight: 20, color: C.searchSecondaryText},
  selectedText: {color: C.searchActionText, fontWeight: '500'},
  sourceScope: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10},
  scopeKind: {fontSize: 11, lineHeight: 16, fontWeight: '600', color: C.searchSecondaryText},
  sourceName: {flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '500', color: C.text, paddingVertical: 8},
  filterClear: {width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center'},
  selectionSummary: {flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border},
  summaryAction: {flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 8},
  summaryText: {fontSize: 12, lineHeight: 18, color: C.searchActionText},
  suggestions: {marginHorizontal: 20, marginTop: 8, marginBottom: 8, borderRadius: 12, backgroundColor: C.background, overflow: 'hidden'},
  suggestion: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10},
  suggestionHash: {fontSize: 17, lineHeight: 23, color: C.searchSecondaryText},
  suggestionName: {flex: 1, fontSize: 15, lineHeight: 22, color: C.text},
  suggestionHint: {padding: 14, fontSize: 13, lineHeight: 20, color: C.searchSecondaryText},
  allTags: {minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border},
  allTagsText: {flex: 1, fontSize: 12, lineHeight: 18, color: C.searchActionText},
  error: {fontSize: 13, lineHeight: 20, color: C.validationError, paddingHorizontal: 20, paddingVertical: 8},
  pressed: {opacity: 0.5},
});
