import React, { useLayoutEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ScreenSurface, SourceIcon, SourceText } from '../components';
import type { MobileScreenProps } from '../navigation/types';
import { useMobile } from '../runtime';
import { mobileColors as C, mobileTypography as T } from '../theme';

export function AboutScreen({navigation}: MobileScreenProps<'About'>) {
  const {t, config} = useMobile();
  const taps = useRef(0);
  useLayoutEffect(() => navigation.setOptions({title: ''}), [navigation]);
  return <ScreenSurface style={styles.content} sourceAppBar>
    <View style={{marginTop: 44}}><SourceIcon name="ic_app_logo" size={64} /></View>
    <SourceText style={[T.loginTitle, {marginTop: 20}]}>Slax Reader</SourceText>
    <Pressable accessibilityRole="button" onPress={() => { if (++taps.current >= 5) { taps.current = 0; navigation.navigate('Debug'); } }} style={{marginTop: 12}}>
      <SourceText style={[T.loginSubtitle, {color: C.mutedText}]}>{t('about_version')} {config.version} ({config.buildNumber})</SourceText>
    </Pressable>
  </ScreenSurface>;
}
const styles = StyleSheet.create({content: {alignItems: 'center', paddingHorizontal: 24}});
