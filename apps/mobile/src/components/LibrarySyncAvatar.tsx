import React, {useEffect, useState} from 'react';
import {useNetworkState} from 'expo-network';
import type {SyncStatus} from '@powersync/common';
import {useMobile} from '../runtime';
import {sourceSyncState} from './sync-state';
import {SourceSyncAvatar} from './SourceSyncAvatar';

/** Owns the sync subscription so progress ticks repaint the avatar, not the library list. */
export function LibrarySyncAvatar({uri}: {uri: string}) {
  const {runtime, config, fixtureOnly} = useMobile();
  const deviceNetwork = useNetworkState(), network = fixtureOnly?.network ?? deviceNetwork;
  const database = runtime.getDatabase(), [sync, setSync] = useState<SyncStatus | undefined>(database?.currentStatus);
  useEffect(() => {
    if (!database) return;
    setSync(database.currentStatus);
    return database.registerListener({statusChanged: setSync});
  }, [database]);
  return <SourceSyncAvatar uri={uri} state={sourceSyncState(sync, network.isConnected !== false && network.isInternetReachable !== false)} isBeta={config.isBeta} />;
}
