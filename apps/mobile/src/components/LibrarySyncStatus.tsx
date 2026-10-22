import React, {useEffect, useState} from 'react';
import {useNetworkState} from 'expo-network';
import type {SyncStatus} from '@powersync/common';
import {View} from 'react-native';
import {useMobile} from '../runtime';
import {sourceSyncState} from './sync-state';
import {SourceProgress, SourceText} from './SourceUI';
import {mobileColors as C, mobileTypography as T} from '../theme';
import {mobileTestIds as IDs} from '../theme/testIds';

/** Owns the sync subscription so progress ticks repaint the sidebar block, not the library list. */
export function LibrarySyncStatus() {
  const {t, runtime, fixtureOnly} = useMobile();
  const deviceNetwork = useNetworkState(), network = fixtureOnly?.network ?? deviceNetwork;
  const database = runtime.getDatabase(), [sync, setSync] = useState<SyncStatus | undefined>(database?.currentStatus);
  useEffect(() => {
    if (!database) return;
    setSync(database.currentStatus);
    return database.registerListener({statusChanged: setSync});
  }, [database]);
  const state = sourceSyncState(sync, network.isConnected !== false && network.isInternetReachable !== false);
  const text = state.kind === 'error' ? state.message : state.kind === 'offline' ? t('sync_no_network') : state.kind === 'uploading' ? t('sync_uploading') : state.kind === 'downloading' ? t('sync_downloading') : state.kind === 'connecting' ? t('sync_connecting') : '';
  if (!text) return null;
  const progress = state.kind === 'downloading' ? state.progress : undefined;
  return <View testID={IDs.SyncStatusBar} style={styles.sync}>
    <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
      <SourceText testID={IDs.SyncStatusText} numberOfLines={1} style={[T.syncStatus, {flex: 1, color: C.bodyText}]}>{text}</SourceText>
      {state.kind === 'downloading' && progress != null ? <SourceText style={[T.syncStatus, {flexShrink: 0}]}>{Math.floor(progress * 100)}%</SourceText> : null}
    </View>
    {state.kind === 'downloading' || state.kind === 'connecting' || state.kind === 'uploading' ? <View style={{marginTop: 8}}><SourceProgress value={progress} testID={IDs.SyncProgress} /></View> : null}
  </View>;
}

const styles = {sync: {marginHorizontal: 12, padding: 12, borderRadius: 8, backgroundColor: C.syncBackground}} as const;
