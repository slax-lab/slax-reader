import React, { useLayoutEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ScreenSurface, SourceIcon, SourceText } from '../components';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileTypography as T } from '../theme';

export function AboutScreen({navigation}: MobileScreenProps<'About'>) {
  const {t, config} = useMobile();
  const taps = useRef(0);
  useLayoutEffect(() => navigation.setOptions({title: ''}), [navigation]);
  return <ScreenSurface sourceAppBar><ScrollView contentContainerStyle={styles.content}>
    <View style={{marginTop: 44}}><SourceIcon name="ic_app_logo" size={64} /></View>
    <SourceText style={[T.loginTitle, {marginTop: 20}]}>Slax Reader</SourceText>
    <Pressable testID="about-version" accessibilityRole="button" onPress={() => { if (++taps.current >= 5) { taps.current = 0; navigation.navigate('Debug'); } }} style={{marginTop: 12}}>
      <SourceText style={[T.loginSubtitle, {color: C.mutedText}]}>{t('about_version')} {config.version} ({config.buildNumber})</SourceText>
    </Pressable>
  </ScrollView></ScreenSurface>;
}
const styles = StyleSheet.create({content: {alignItems: 'center', paddingHorizontal: 24, paddingBottom: 32}});
