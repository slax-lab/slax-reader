import React from 'react';
import {View} from 'react-native';
import {SourceButton, SourceText} from '../components/SourceUI';
import {mobileColors as C, mobileTypography as T} from '../theme';

export function WidgetCleanupNotice({visible, t, onRetry}: {visible: boolean; t(key: string): string; onRetry(): void}) {
  if (!visible) return null;
  return <View pointerEvents="box-none" style={{position: 'absolute', left: 12, right: 12, bottom: 16, alignItems: 'center'}}>
    <View accessibilityRole="alert" style={{width: '100%', maxWidth: 520, padding: 14, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border}}>
      <SourceText style={[T.metadata, {color: C.text, marginBottom: 8}]}>{t('widget_cleanup_failed')}</SourceText>
      <SourceButton label={t('widget_cleanup_retry')} tone="surface" onPress={onRetry} />
    </View>
  </View>;
}
