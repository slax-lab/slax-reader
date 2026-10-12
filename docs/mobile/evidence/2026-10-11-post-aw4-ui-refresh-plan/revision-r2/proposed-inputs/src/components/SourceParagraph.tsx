import React, {useState} from 'react';
import {Platform, useWindowDimensions, type StyleProp, type ViewProps, type ViewStyle} from 'react-native';
import {requireNativeViewManager} from 'expo-modules-core';
import {SourceText} from './SourceUI';
import {sourceTextDimensions} from './source-font-scaling';

interface TextMetrics {
  height: number; layoutWidth: number; text: string; fontSize: number; fontWeight: number;
  fontScale: number; lineHeightSp: number; maxLines: number; paragraph: boolean; measurementKey: string;
}
interface NativeParagraphProps extends ViewProps {
  text: string; fontSize: number; fontWeight: number; textColor: string;
  alignment: 'left' | 'center' | 'right'; paragraph: boolean; maxLines: number; lineHeightSp: number;
  measurementKey: string; ellipsis: 'end'; centerAsGroup: boolean;
  onTextMetrics(event: {nativeEvent: TextMetrics}): void;
}
const NativeText = Platform.OS === 'android' ? requireNativeViewManager<NativeParagraphProps>('SlaxPlatform', 'SlaxTextView') : null;

/** Plain paragraphs retain the source fractional paint and native trimmed line-height span. */
export function SourceParagraph({text, fontSize, lineHeight, fontWeight = 400, color, alignment = 'left', maxLines = 0, style, testID, accessibilityLabel}: {
  text: string; fontSize: number; lineHeight: number; fontWeight?: number; color: string;
  alignment?: NativeParagraphProps['alignment']; maxLines?: number; style?: StyleProp<ViewStyle>;
  testID?: string; accessibilityLabel?: string;
}) {
  const {fontScale, scale, width: windowWidth, height: windowHeight} = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [metrics, setMetrics] = useState<{key: string; height: number} | null>(null);
  const key = JSON.stringify([text, fontSize, fontWeight, fontScale, lineHeight, maxLines, alignment, layoutWidth, windowWidth, windowHeight]);
  if (!NativeText) return <SourceText testID={testID} accessibilityLabel={accessibilityLabel ?? text}
    numberOfLines={maxLines > 0 ? maxLines : undefined}
    style={[{fontSize, lineHeight, fontWeight: String(fontWeight) as '400', color, letterSpacing: 0, textAlign: alignment}, style]}>{text}</SourceText>;
  return <NativeText testID={testID} accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel ?? text}
    text={text} fontSize={fontSize} fontWeight={fontWeight} textColor={color} alignment={alignment}
    paragraph maxLines={maxLines} lineHeightSp={lineHeight} measurementKey={key} ellipsis="end" centerAsGroup={false}
    style={[{height: metrics?.key === key ? metrics.height : sourceTextDimensions({fontSize, lineHeight}, fontScale).lineHeight, alignSelf: 'stretch'}, style]}
    onLayout={event => {
      const width = event.nativeEvent.layout.width;
      if (Number.isFinite(width) && width > 0) setLayoutWidth(previous => previous === width ? previous : width);
    }}
    onTextMetrics={event => {
      const measured = event.nativeEvent;
      if (layoutWidth <= 0 || measured.measurementKey !== key || !measured.paragraph || measured.text !== text || measured.fontSize !== fontSize || measured.fontWeight !== fontWeight || measured.lineHeightSp !== lineHeight || measured.maxLines !== maxLines) return;
      // Fabric reports Yoga's fractional width; Android rounds view bounds to
      // physical pixels. The request key still rejects the prior width/frame.
      const pixel = 1 / (Number.isFinite(scale) && scale > 0 ? scale : 1);
      if (!Number.isFinite(measured.fontScale) || Math.abs(measured.fontScale - fontScale) > 1e-6 || !Number.isFinite(measured.layoutWidth) || Math.abs(measured.layoutWidth - layoutWidth) > pixel + 1e-4) return;
      if (!Number.isFinite(measured.height) || measured.height <= 0) return;
      setMetrics(previous => previous?.key === key && previous.height === measured.height ? previous : {key, height: measured.height});
    }} />;
}
