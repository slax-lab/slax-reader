import React from 'react';
import {ActivityIndicator, Alert, FlatList, Linking, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ScreenSurface, SourceButton, SourceText} from '../components';
import {DiscoveryCard} from '../discovery/DiscoveryCard';
import {useDiscoveryFeed} from '../discovery/useDiscoveryFeed';
import {useMobile} from '../runtime';
import {mobileColors as C} from '../theme';

export function DiscoverScreen() {
  const {api, session, nativeResourceOwner} = useMobile();
  if (session.status !== 'authenticated') return null;
  return <DiscoverFeed key={JSON.stringify([session.session.userId, api.options.baseUrl, nativeResourceOwner])}/>;
}

function DiscoverFeed() {
  const {api, config, t} = useMobile();
  const {state, retry} = useDiscoveryFeed(api);
  const insets = useSafeAreaInsets();
  const cards = state.status === 'ready' ? state.result.items.filter(item => item.articles.length) : [];
  function openPublic(kind: 'b' | 'c', id: string) {
    void Linking.openURL(config.webUrl + '/' + kind + '/' + encodeURIComponent(id))
      .catch(() => Alert.alert(t('discover_link_error')));
  }
  const emptyKey = state.status === 'ready' && state.result.reason === 'cold_start' ? 'discover_cold' : 'discover_empty';
  return <ScreenSurface style={styles.screen}>
    <FlatList data={cards} keyExtractor={item => item.code} contentContainerStyle={[styles.content, {paddingLeft: 18 + insets.left, paddingRight: 18 + insets.right}]}
      ListHeaderComponent={cards.length ? <SourceText accessibilityRole="header" style={styles.kicker}>{t('discover_for_you')}</SourceText> : undefined}
      renderItem={({item, index}) => <DiscoveryCard collection={item} featured={index === 0} t={t}
        openCollection={code => openPublic('c', code)} openArticle={id => openPublic('b', id)}/>}
      ListEmptyComponent={<View style={styles.status}>
        {state.status === 'loading' ? <ActivityIndicator accessibilityLabel={t('discover_loading')} color={C.accent}/> : <>
          <SourceText accessibilityLiveRegion="polite">{t(state.status === 'error' ? 'discover_error' : emptyKey)}</SourceText>
          {state.status === 'error' ? <SourceButton label={t('discover_retry')} onPress={retry}/> : null}
        </>}
      </View>}/>
  </ScreenSurface>;
}

const styles = StyleSheet.create({
  screen: {backgroundColor: C.readerBackground},
  content: {paddingTop: 10, paddingBottom: 32},
  kicker: {fontSize: 15, fontWeight: '600', marginBottom: 12, color: C.secondaryText},
  status: {alignItems: 'center', gap: 16, paddingVertical: 40},
});
