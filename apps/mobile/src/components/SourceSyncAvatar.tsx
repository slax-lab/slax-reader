import React from 'react';
import {StyleSheet, View} from 'react-native';
import {SourceAvatar, SourceIcon, SourceText} from './SourceUI';
import {SourceRing} from './SourceRing';
import type {SourceSyncState} from './sync-state';

export function SourceSyncAvatar({uri, state, isBeta = false}: {uri: string; state: SourceSyncState; isBeta?: boolean}) {
  const pending = state.kind === 'uploading' || state.kind === 'connecting';
  const color = state.kind === 'offline' ? '#9E9E9E' : state.kind === 'error' ? '#E53935' : state.kind === 'connecting' ? '#16B998' : '#1DA1F2';
  const progress = state.kind === 'downloading' ? state.progress : pending ? 0.3 : 1;
  const badge = state.kind === 'downloading' ? '↓' : state.kind === 'uploading' ? '↑' : state.kind === 'error' ? 'x' : null;
  return <View style={{width: 24, height: 24, alignItems: 'center', justifyContent: 'center'}}>
    <SourceAvatar resourceKey="self" uri={uri} size={20} label="Avatar"/>
    {state.kind !== 'connected' ? <View style={StyleSheet.absoluteFill}><SourceRing size={24} thickness={1} geometry="material" track={state.kind === 'offline' || state.kind === 'error' ? '#E5393533' : '#33333333'} segments={[{fraction: progress, color}]} indeterminate={pending}/></View> : null}
    {badge || state.kind === 'offline' ? <View style={{position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: state.kind === 'offline' ? '#808080' : '#1DA1F2'}}>{state.kind === 'offline' ? <SourceIcon name="ic_inbox_plane" size={8}/> : <SourceText style={{color: '#FFFFFF', fontSize: 7, lineHeight: 8, fontWeight: '700'}}>{badge}</SourceText>}</View> : null}
    {isBeta ? <View style={{position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF6D00', alignItems: 'center', justifyContent: 'center'}}><SourceText style={{fontSize: 7, lineHeight: 10, color: '#FFFFFF', fontWeight: '700'}}>β</SourceText></View> : null}
  </View>;
}
