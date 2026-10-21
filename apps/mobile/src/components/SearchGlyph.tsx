import React from 'react';
import {StyleSheet, View} from 'react-native';
import {mobileColors as C} from '../theme';
/** Monochrome search geometry uses the Mobile text role. The button owns its label. */
export function SearchGlyph() {
  return <View accessible={false} style={styles.box}><View style={styles.lens}/><View style={styles.handle}/></View>;
}
const styles = StyleSheet.create({box: {width: 24, height: 24}, lens: {position: 'absolute', top: 3, left: 3, width: 14, height: 14, borderWidth: 1.8, borderRadius: 7, borderColor: C.text}, handle: {position: 'absolute', left: 16, top: 15, width: 8, height: 1.8, borderRadius: 1, backgroundColor: C.text, transform: [{rotate: '45deg'}]}});
