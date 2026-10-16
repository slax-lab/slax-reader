import React from 'react'
import {View} from 'react-native'

/** Article-style placeholder. `lines` renders only the body rows, for use beneath an already visible header. */
export function ReaderSkeleton({topSpacer = 0, header, lines = false}: {topSpacer?: number; header?: React.ReactNode; lines?: boolean}) {
  return <View testID={lines ? 'reader-body-skeleton' : 'detail_skeleton'} accessible={false} importantForAccessibility="no-hide-descendants" style={lines ? undefined : {flex: 1}}>
    {lines ? null : header}
    <View style={{paddingHorizontal: 20, paddingTop: header || lines ? 0 : topSpacer + 12}}>
      {!header && !lines ? <><View style={{width: '70%', height: 30, backgroundColor: '#F0F0F0', borderRadius: 4}} />
        <View style={{flexDirection: 'row', gap: 16, marginTop: 16}}>
          <View style={{width: 100, height: 20, backgroundColor: '#F0F0F0', borderRadius: 4}} />
          <View style={{width: 80, height: 20, backgroundColor: '#F0F0F0', borderRadius: 4}} />
        </View><View style={{height: 8, marginTop: 12}} /></> : null}
      {Array.from({length: lines ? 10 : 6}, (_, index) => <View key={index} style={{marginTop: 12, width: index % 3 === 0 ? '85%' : '100%', height: 16, backgroundColor: '#F5F5F5', borderRadius: 4}} />)}
    </View>
  </View>
}
