import React from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import type {RecommendedCollection} from '@slax-reader/contracts/collections';
import type {createTranslator} from '../i18n';
import {mobileColors as C} from '../theme';

type CardProps = {
  collection: RecommendedCollection;
  featured: boolean;
  t: ReturnType<typeof createTranslator>;
  openCollection(code: string): void;
  openArticle(uuid: string): void;
};

export function DiscoveryCard({collection, featured, t, openCollection, openArticle}: CardProps) {
  const [lead, ...companions] = collection.articles;
  if (!lead) return null;
  const ink = featured ? styles.coverInk : undefined;
  const reason = lead.selectionReason === 'saved_interest' ? t('discover_saved_interest')
    : lead.selectionReason === 'interest' ? t('discover_interest') : undefined;
  const metadata = [lead.siteName, reason].filter(Boolean).join(' · ');
  return <View style={[styles.card, featured && styles.cover]}>
    <Pressable accessibilityRole="link" onPress={() => openCollection(collection.code)} style={pressStyle}>
      <Text style={[styles.collection, ink]}>{collection.name || t('discover_untitled')} ↗</Text>
    </Pressable>
    <Pressable accessibilityRole="link" onPress={() => openArticle(lead.bookmarkUuid)} style={pressStyle}>
      <Text accessibilityRole="header" style={[styles.headline, featured && styles.coverHeadline, ink]}>{lead.title || lead.url}</Text>
    </Pressable>
    {metadata ? <Text style={[styles.meta, ink]}>{metadata}</Text> : null}
    {companions.slice(0, 2).map(article => <Pressable accessibilityRole="link" key={article.bookmarkUuid}
      style={({pressed}) => [styles.companion, featured && styles.coverRule, pressed && styles.pressed]}
      onPress={() => openArticle(article.bookmarkUuid)}>
      <Text style={[styles.companionTitle, ink]}>{article.title || article.url}</Text>
      <Text accessible={false} style={ink}>↗</Text>
    </Pressable>)}
  </View>;
}

const pressStyle = ({pressed}: {pressed: boolean}) => [styles.target, pressed && styles.pressed];
const styles = StyleSheet.create({
  card: {borderTopWidth: 1, borderColor: C.buttonBorder, paddingVertical: 12, marginBottom: 12},
  cover: {backgroundColor: C.discoveryCover, borderTopWidth: 0, borderRadius: 6, paddingHorizontal: 16},
  coverInk: {color: C.discoveryCoverText},
  pressed: {opacity: 0.7},
  target: {minHeight: 44, justifyContent: 'center'},
  collection: {fontSize: 14, fontWeight: '600', color: C.secondaryText},
  headline: {fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 23, fontWeight: '700', color: C.text},
  coverHeadline: {fontSize: 30},
  meta: {fontSize: 13, marginVertical: 6, color: C.secondaryText},
  companion: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.buttonBorder},
  coverRule: {borderColor: C.discoveryCoverText},
  companionTitle: {flex: 1, fontSize: 15, color: C.bodyText},
});
