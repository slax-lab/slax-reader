import React from 'react'
import {StyleSheet, View} from 'react-native'

/** Fixed-size native header item root shared by the route placeholder and the live More control, so filling it never re-lays out the bar. */
export function ReaderHeaderSlot({children}: {children?: React.ReactNode}) {
  return <View testID="reader-header-slot" collapsable={false} style={styles.slot}>{children}</View>
}
const styles = StyleSheet.create({slot: {minWidth: 48, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end'}})
