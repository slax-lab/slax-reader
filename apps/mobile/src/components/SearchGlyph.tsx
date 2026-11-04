import React from 'react';
import {StyleSheet, View} from 'react-native';
import {mobileColors as C} from '../theme';
/** Match the Library add icon's 14-point painted bounds and 1.5-point stroke. The button owns its label. */
export function SearchGlyph() {
  return <View accessible={false} style={styles.box}><View style={styles.lens}/><View style={styles.handle}/></View>;
}
const styles = StyleSheet.create({box: {width: 24, height: 24}, lens: {position: 'absolute', top: 5, left: 5, width: 11, height: 11, borderWidth: 1.5, borderRadius: 5.5, borderColor: C.bodyText}, handle: {position: 'absolute', left: 13.35, top: 15.6, width: 6, height: 1.5, borderRadius: 0.75, backgroundColor: C.bodyText, transform: [{rotate: '45deg'}]}});
