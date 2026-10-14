import React, {useEffect, useRef, useState} from 'react'
import {Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions} from 'react-native'
import {SourceIcon, SourceText, TextAction} from '../components'
import type {TagRecord} from '../data'
import type {createTranslator} from '../i18n'
import {ReaderSheet} from './ReaderOverlays'
import {addDraftTag, emptyTagDraft, reconcileTagDraft, removeDraftTag, selectedTagIds, similarTags} from './tags.ts'

export function ReaderTagSheet({visible, tags, remoteIds, t, onDismiss, onConfirm, onCreate, onError}: {
  visible: boolean; tags: TagRecord[]; remoteIds: string[]; t: ReturnType<typeof createTranslator>;
  onDismiss(): void; onConfirm(ids: string[]): void; onCreate(name: string): Promise<TagRecord>; onError(error: unknown): void;
}) {
  const viewport = useWindowDimensions()
  const [draft, setDraft] = useState(emptyTagDraft<TagRecord>)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const remoteKey = JSON.stringify(remoteIds)
  useEffect(() => {generation.current++; if (!visible) {setDraft(emptyTagDraft()); setCreating(false); setQuery(''); setBusy(false)}}, [visible])
  useEffect(() => setDraft(previous => reconcileTagDraft(previous, remoteIds)), [remoteKey])
  const selected = selectedTagIds(draft, remoteIds)
  const allTags = [...tags, ...draft.added.filter(tag => !tags.some(item => item.id === tag.id))]
  const add = (tag: TagRecord) => {setDraft(previous => addDraftTag(previous, tag, remoteIds)); setCreating(false); setQuery('')}
  const create = async () => {
    if (!query.trim() || busy) return
    const existing = tags.find(tag => tag.tag_name.toLowerCase() === query.trim().toLowerCase())
    if (existing) {if (!selected.includes(existing.id)) add(existing); else {setCreating(false); setQuery('')}; return}
    setBusy(true)
    const requestGeneration = generation.current
    try {const tag = await onCreate(query.trim()); if (generation.current === requestGeneration) add(tag)} catch (error) {onError(error)} finally {if (generation.current === requestGeneration) setBusy(false)}
  }
  const matches = similarTags(tags, selected, query)
  const hasMatch = matches.some(tag => tag.tag_name.toLowerCase() === query.toLowerCase())
  const dismiss = () => {if (creating) {setCreating(false); setQuery('')} else onDismiss()}
  const tagItem = (tag: TagRecord, remove = false) => <View key={tag.id} style={styles.tag} testID="tag_item">
    <Pressable accessibilityRole="button" disabled={remove} onPress={() => setDraft(previous => addDraftTag(previous, tag, remoteIds))}><SourceText numberOfLines={1} style={styles.tagText}>{tag.tag_name}</SourceText></Pressable>
    {remove ? <><View style={{width: 1, height: 12, backgroundColor: '#0F141914'}} /><Pressable accessibilityRole="button" accessibilityLabel={`${t('bookmark_delete')} ${tag.tag_name}`} onPress={() => setDraft(previous => removeDraftTag(previous, tag.id, remoteIds))}><SourceIcon name="ic_xs_tag_close" size={14} /></Pressable></> : null}
  </View>
  return <ReaderSheet visible={visible} onDismiss={dismiss} testID="reader-tags-sheet">
    <View style={{height: viewport.height * 0.65, backgroundColor: '#FFFFFF'}}>
      <View style={styles.heading}><TextAction color="#333333" style={{fontSize: 15, lineHeight: 20}} label={t(creating ? 'btn_back' : 'btn_cancel')} onPress={dismiss} />
        <SourceText style={{fontSize: 16, fontWeight: '600', lineHeight: 20, color: '#0F1419'}}>{t(creating ? 'tags_create_title' : 'tags_title')}</SourceText>
        {!creating ? <TextAction style={{fontSize: 15, fontWeight: '500', lineHeight: 20}} label={t('btn_confirm')} onPress={() => onConfirm(selected)} /> : <View style={{width: 40}} />}
      </View><View style={{height: 0.5, backgroundColor: '#33333314', marginHorizontal: 24}} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: 24, paddingVertical: 20}}>
        {creating ? <>
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder={t('tags_input_placeholder')} placeholderTextColor="#A28D6499" selectionColor="#16B998" returnKeyType="done" onSubmitEditing={() => {void create()}} style={[styles.createInput, {color: '#0F1419', fontWeight: '700'}]} />
          {query.trim() && !hasMatch ? <Pressable disabled={busy} onPress={() => {void create()}} accessibilityRole="button" style={styles.createRow}><SourceIcon name="ic_cell_tag" size={14} /><SourceText style={{fontSize: 15, color: '#A28D64', marginLeft: 11}}>{t('tags_create_prefix')}{query}</SourceText></Pressable> : null}
          {query.trim() && matches.length && !hasMatch ? <View style={{height: 0.5, backgroundColor: '#33333314'}} /> : null}
          {matches.map(tag => <Pressable key={tag.id} accessibilityRole="button" onPress={() => add(tag)} style={[styles.createRow, {height: 44}]}><SourceIcon name="ic_cell_tag" size={14} /><SourceText style={{fontSize: 15, lineHeight: 21, color: '#999999', marginLeft: 11}}>{tag.tag_name}</SourceText></Pressable>)}
        </> : <>
          {selected.length ? <><SourceText style={styles.label}>{t('tags_added')}</SourceText><View style={[styles.flow, {marginBottom: 30}]}>{allTags.filter(tag => selected.includes(tag.id)).map(tag => tagItem(tag, true))}</View></> : null}
          <SourceText style={styles.label}>{t('tags_available')}</SourceText><Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.createInput}><SourceText style={{fontSize: 15, lineHeight: 21, color: '#A28D6499'}}>{t('tags_create_new')}</SourceText></Pressable>
          <View style={[styles.flow, {marginTop: 16}]}>{allTags.filter(tag => !selected.includes(tag.id)).map(tag => tagItem(tag))}</View>
        </>}
      </ScrollView>
    </View>
  </ReaderSheet>
}
const styles = StyleSheet.create({heading: {height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16}, label: {fontSize: 14, lineHeight: 20, color: '#999999', marginBottom: 12}, flow: {flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 16}, tag: {height: 30, maxWidth: '100%', borderRadius: 3, borderWidth: 1, borderColor: '#E4D6BA', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 8}, tagText: {fontSize: 15, lineHeight: 21, color: '#A28D64'}, createInput: {height: 44, borderWidth: 0.5, borderColor: '#0F141914', borderRadius: 4, backgroundColor: '#F5F5F3F2', justifyContent: 'center', paddingHorizontal: 12, fontSize: 15}, createRow: {height: 60, flexDirection: 'row', alignItems: 'center', paddingLeft: 11}})
