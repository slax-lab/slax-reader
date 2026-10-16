import {addNetworkStateListener, getNetworkStateAsync} from 'expo-network';
import type {NetworkAvailabilitySource} from './network-availability.ts';

export const nativeNetwork: NetworkAvailabilitySource = {
  read: getNetworkStateAsync,
  subscribe(listener) {const subscription = addNetworkStateListener(listener); return () => subscription.remove();},
};
