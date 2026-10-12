import React from 'react';
import {Platform, View, type ViewProps} from 'react-native';
import {requireNativeViewManager} from 'expo-modules-core';

interface ShapeProps extends ViewProps {
  radius: number; corners: 'all' | 'top'; fillColor: string; borderColor: string; borderWidth: number;
}
const NativeShape = Platform.OS === 'android' ? requireNativeViewManager<ShapeProps>('SlaxPlatform', 'SlaxShapeView') : null;

/** Rounded source surfaces retain Yoga children and source Android outline/border geometry. */
export function SourceShape({radius = 16, corners = 'all', fillColor = '#00000000', borderColor = '#00000000', borderWidth = 0, style, ...props}: ViewProps & Partial<Pick<ShapeProps, 'radius' | 'corners' | 'fillColor' | 'borderColor' | 'borderWidth'>>) {
  if (NativeShape) return <NativeShape {...props} radius={radius} corners={corners} fillColor={fillColor} borderColor={borderColor} borderWidth={borderWidth} style={style} />;
  return <View {...props} style={[{backgroundColor: fillColor, borderColor, borderWidth, borderTopLeftRadius: radius, borderTopRightRadius: radius, ...(corners === 'all' ? {borderBottomLeftRadius: radius, borderBottomRightRadius: radius} : {}), overflow: 'hidden'}, style]} />;
}
