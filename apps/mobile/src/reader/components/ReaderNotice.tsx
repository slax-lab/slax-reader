import React from 'react'
import {StyleSheet, View} from 'react-native'
import {SourceText} from '../../components'
import {mobileColors as C, mobileTypography as T} from '../../theme'

export function ReaderNotice({message}: {message: string | null}) {
  if (!message) return null
  return <View pointerEvents="none" accessibilityLiveRegion="polite" style={[StyleSheet.absoluteFill, styles.center]}>
    <View style={styles.notice}><SourceText style={[T.helper, {color: C.surface}]}>{message}</SourceText></View>
  </View>
}
const styles = StyleSheet.create({
  center: {alignItems: 'center', justifyContent: 'center'},
  notice: {maxWidth: '90%', backgroundColor: C.bodyText, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10},
})
