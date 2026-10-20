import React from 'react';
import {PixelRatio, Platform, View, type ViewProps} from 'react-native';
import {requireNativeView} from 'expo';

interface NativeRingProps extends ViewProps {
  diameter: number; thickness: number; segments: string; track: string;
  geometry: 'cache' | 'material' | 'circle'; revealDuration: number; indeterminate: boolean;
}

/** Android matches the source CircleShape's integer physical border stroke. */
export function SourceCircle({size, thickness, border, fill = '#00000000'}: {size: number; thickness: number; border: string; fill?: string}) {
  if (Platform.OS !== 'android') return <View pointerEvents="none" accessible={false} style={{width: size, height: size, borderRadius: size / 2, borderWidth: thickness, borderColor: border, backgroundColor: fill}} />;
  const roundedSize = PixelRatio.roundToNearestPixel(size);
  return <NativeRing pointerEvents="none" accessible={false} diameter={size} thickness={thickness} segments={JSON.stringify([{fraction: 1, color: border}])} track={fill}
    geometry="circle" revealDuration={0} indeterminate={false} style={{width: roundedSize, height: roundedSize}} />;
}
const NativeRing = requireNativeView<NativeRingProps>('SlaxPlatform', 'SlaxRingView');

/** The source cache canvas can draw half a stroke outside its logical layout bounds. */
export function SourceRing({size, thickness, segments, track = '#E8E6E3', revealDuration = 0, indeterminate = false, geometry = 'cache'}: {
  size: number; thickness: number; segments: {fraction: number; color: string}[]; track?: string; revealDuration?: number; indeterminate?: boolean; geometry?: 'cache' | 'material';
}) {
  const overflow = geometry === 'cache' ? thickness / 2 : 0;
  return <View pointerEvents="none" accessible={false} style={{width: size, height: size, overflow: 'visible'}}>
    <NativeRing pointerEvents="none" accessible={false} diameter={size} thickness={thickness} segments={JSON.stringify(segments)} track={track} geometry={geometry} revealDuration={revealDuration} indeterminate={indeterminate}
      style={{position: 'absolute', left: -overflow, top: -overflow, width: size + overflow * 2, height: size + overflow * 2}}/>
  </View>;
}

/** Pinned Material3 CircularProgressIndicator defaults are 40dp and a 4dp stroke. */
export function SourceCircularProgress({size = 40, thickness = 4, color}: {size?: number; thickness?: number; color: string}) {
  return <View accessibilityRole="progressbar" style={{width: size, height: size}}>
    <SourceRing size={size} thickness={thickness} geometry="material" indeterminate track="#00000000" segments={[{fraction: 1, color}]} />
  </View>;
}
