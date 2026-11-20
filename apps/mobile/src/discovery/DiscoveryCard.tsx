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

function publication(article: RecommendedCollection['articles'][number]) {
  if (article.siteName?.trim()) return article.siteName.trim();
  try {
    return new URL(article.url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function DiscoveryCard({collection, featured, t, openCollection, openArticle}: CardProps) {
  const [lead, ...companions] = collection.articles;
  if (!lead) return null;
  const ink = featured ? styles.coverInk : undefined;
  const reason = lead.selectionReason === 'saved_interest' ? t('discover_saved_interest')
    : lead.selectionReason === 'interest' ? t('discover_interest') : undefined;
  const site = publication(lead);
  const name = collection.name || t('discover_untitled');
  return <View style={[styles.card, featured && styles.cover]}>
    <Pressable accessibilityRole="link" accessibilityLabel={name} onPress={() => openCollection(collection.code)}
      style={({pressed}) => [styles.masthead, featured && styles.coverRule, pressed && styles.pressed]}>
      <View style={[styles.bookplate, featured && styles.coverRule]}>
        <Text accessible={false} style={[styles.initial, ink]}>{Array.from(name.trim())[0]}</Text>
      </View>
      <View style={styles.identity}>
        <Text style={[styles.label, ink]}>{t('discover_collection')}</Text>
        <Text style={[styles.collection, ink]}>{name}</Text>
      </View>
      <Text accessible={false} style={ink}>↗</Text>
    </Pressable>
    <Pressable accessibilityRole="link" onPress={() => openArticle(lead.bookmarkUuid)} style={pressStyle}>
      <Text accessibilityRole="header" style={[styles.headline, featured && styles.coverHeadline, ink]}>{lead.title || lead.url}</Text>
    </Pressable>
    {site || reason ? <Text style={[styles.meta, ink]}>
      <Text style={styles.site}>{site}</Text>{site && reason ? '  ·  ' : ''}{reason}
    </Text> : null}
    {companions.slice(0, 2).map(article => <Pressable accessibilityRole="link" key={article.bookmarkUuid}
      style={({pressed}) => [styles.companion, featured && styles.coverRule, pressed && styles.pressed]}
      onPress={() => openArticle(article.bookmarkUuid)}>
      <Text style={[styles.companionTitle, ink]}>{article.title || article.url}</Text>
      <Text style={[styles.publisher, ink]}>{publication(article)}</Text>
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
  masthead: {flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingBottom: 12, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.buttonBorder},
  bookplate: {width: 35, height: 43, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderLeftWidth: 3, borderTopRightRadius: 4, borderBottomRightRadius: 4, borderColor: C.secondaryText},
  initial: {fontSize: 20, fontWeight: '600', color: C.bodyText},
  identity: {flex: 1},
  label: {fontSize: 11, color: C.secondaryText},
  collection: {fontSize: 19, fontWeight: '600', color: C.bodyText},
  site: {fontWeight: '600'},
  publisher: {maxWidth: '37%', fontSize: 12, color: C.secondaryText, textAlign: 'right'},
  headline: {fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 23, fontWeight: '700', color: C.text},
  coverHeadline: {fontSize: 30},
  meta: {fontSize: 13, marginVertical: 6, color: C.secondaryText},
  companion: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.buttonBorder},
  coverRule: {borderColor: C.discoveryCoverText},
  companionTitle: {flex: 1, fontSize: 15, color: C.bodyText},
});
