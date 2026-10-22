import React from 'react';
import {StyleSheet, View} from 'react-native';
import {mobileColors as C} from '../theme';

/** Controls own the labels; these small marks are decorative. */
export function SearchChevron({down = false}: {down?: boolean}) {
  return <View accessible={false} style={styles.box}>
    <View style={[styles.chevron, down && {transform: [{rotate: '45deg'}]}]}/>
  </View>;
}

export function SearchClose() {
  return <View accessible={false} style={styles.box}>
    <View style={[styles.stroke, {transform: [{rotate: '45deg'}]}]}/>
    <View style={[styles.stroke, {transform: [{rotate: '-45deg'}]}]}/>
  </View>;
}

export function SearchCheck() {
  return <View accessible={false} style={styles.box}><View style={styles.check}/></View>;
}

const styles = StyleSheet.create({
  box: {width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0},
  chevron: {width: 6, height: 6, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderColor: C.searchSecondaryText, transform: [{rotate: '-45deg'}]},
  stroke: {position: 'absolute', width: 10, height: 1.5, borderRadius: 1, backgroundColor: C.searchSecondaryText},
  check: {width: 5, height: 9, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderColor: C.searchActionText, transform: [{rotate: '45deg'}]},
});
