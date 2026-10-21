import React from 'react';
import {StyleSheet, View} from 'react-native';
import {mobileColors as C} from '../theme';
/** Monochrome search geometry uses the Mobile text role. The button owns its label. */
export function SearchGlyph() {
  return <View accessible={false} style={styles.box}><View style={styles.lens}/><View style={styles.handle}/></View>;
}
// Anchor the handle on the lens diagonal; keep the visible glyph close to the 24pt add icon's ~14pt mark.
const styles = StyleSheet.create({box: {width: 24, height: 24}, lens: {position: 'absolute', top: 4, left: 4, width: 12, height: 12, borderWidth: 1.8, borderRadius: 6, borderColor: C.text}, handle: {position: 'absolute', left: 12.7, top: 14.8, width: 6, height: 1.8, borderRadius: 1, backgroundColor: C.text, transform: [{rotate: '45deg'}]}});
