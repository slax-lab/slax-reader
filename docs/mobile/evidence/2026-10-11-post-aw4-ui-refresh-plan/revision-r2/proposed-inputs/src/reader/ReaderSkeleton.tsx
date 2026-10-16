import React from 'react'
import {View} from 'react-native'

/** Original DetailScreenSkeleton spacing; the iOS shell supplies status padding plus its 44dp spacer. */
export function ReaderSkeleton({topSpacer}: {topSpacer: number}) {
  return <View testID="detail_skeleton" style={{flex: 1, paddingHorizontal: 20, paddingTop: topSpacer + 12}}>
    <View style={{width: '70%', height: 30, backgroundColor: '#F0F0F0', borderRadius: 4}} />
    <View style={{flexDirection: 'row', gap: 16, marginTop: 16}}>
      <View style={{width: 100, height: 20, backgroundColor: '#F0F0F0', borderRadius: 4}} />
      <View style={{width: 80, height: 20, backgroundColor: '#F0F0F0', borderRadius: 4}} />
    </View>
    <View style={{height: 8, marginTop: 12}} />
    {Array.from({length: 6}, (_, index) => <View key={index} style={{marginTop: 12, width: index % 3 === 0 ? '85%' : '100%', height: 16, backgroundColor: '#F5F5F5', borderRadius: 4}} />)}
  </View>
}
