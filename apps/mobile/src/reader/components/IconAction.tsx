import React from 'react'
import {Pressable} from 'react-native'
import type {MobileAssetName} from '../../../assets'
import {SourceIcon} from '../../components'

export function IconAction({name, label, onPress, size = 24, disabled = false, testID}: {name: MobileAssetName; label: string; onPress(): void; size?: number; disabled?: boolean; testID?: string}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} testID={testID} hitSlop={8} style={({pressed}) => [{opacity: disabled ? 0.4 : pressed ? 0.5 : 1, padding: 8}]}><SourceIcon name={name} size={size} /></Pressable>
}
