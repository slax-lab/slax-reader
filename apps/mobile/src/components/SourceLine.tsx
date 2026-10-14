import React, {useState} from 'react';
import {Platform, useWindowDimensions, type StyleProp, type ViewProps, type ViewStyle} from 'react-native';
import {requireNativeViewManager} from 'expo-modules-core';
import {SourceText} from './SourceUI';

interface NativeTextProps extends ViewProps {
  text: string; fontSize: number; fontWeight: number; textColor: string;
  alignment: 'left' | 'center' | 'right'; ellipsis: 'end' | 'middle' | 'clip';
  centerAsGroup: boolean;
  onTextMetrics(event: {nativeEvent: {height: number; width: number; text: string; fontSize: number; fontWeight: number; fontScale: number}}): void;
}
const NativeText = Platform.OS === 'android' ? requireNativeViewManager<NativeTextProps>('SlaxPlatform', 'SlaxTextView') : null;

/** Plain source labels use Android TextPaint and iOS UIKit text with the requested truncation mode. */
export function SourceLine({text, fontSize, lineHeight, fontWeight = 400, color, alignment = 'left', centerAsGroup = false, fitContent = false, ellipsis = 'end', style, testID}: {
  text: string; fontSize: number; lineHeight: number; fontWeight?: number; color: string;
  alignment?: NativeTextProps['alignment']; ellipsis?: NativeTextProps['ellipsis']; style?: StyleProp<ViewStyle>; testID?: string;
  centerAsGroup?: boolean; fitContent?: boolean;
}) {
  const {fontScale} = useWindowDimensions();
  const [metrics, setMetrics] = useState<{key: string; height: number; width: number} | null>(null);
  const key = `${fontSize}/${fontWeight}/${fontScale}/${text}`;
  if (!NativeText) return <SourceText testID={testID} numberOfLines={1} ellipsizeMode={ellipsis === 'end' ? 'tail' : ellipsis}
    style={[{fontSize, lineHeight, fontWeight: String(fontWeight) as '400', color, letterSpacing: 0, textAlign: centerAsGroup ? 'center' : alignment}, style]}>{text}</SourceText>;
  return <NativeText testID={testID} accessible accessibilityRole="text" accessibilityLabel={text} text={text} fontSize={fontSize} fontWeight={fontWeight}
    textColor={color} alignment={alignment} centerAsGroup={centerAsGroup} ellipsis={ellipsis}
    style={[{height: metrics?.key === key ? metrics.height : lineHeight * fontScale, alignSelf: 'stretch', ...(fitContent ? {width: metrics?.key === key ? metrics.width : 1} : {})}, style]}
    onTextMetrics={event => {
      const measured = event.nativeEvent;
      if (measured.text !== text || measured.fontSize !== fontSize || measured.fontWeight !== fontWeight || !Number.isFinite(measured.fontScale) || Math.abs(measured.fontScale - fontScale) > 1e-6) return;
      if (!Number.isFinite(measured.height) || measured.height <= 0 || !Number.isFinite(measured.width) || measured.width <= 0) return;
      setMetrics(previous => previous?.key === key && previous.height === measured.height && previous.width === measured.width ? previous : {key, height: measured.height, width: measured.width});
    }} />;
}
