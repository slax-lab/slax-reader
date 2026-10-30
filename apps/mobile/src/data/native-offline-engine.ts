import {requireNativeModule} from 'expo';
import {unavailableOfflineEngine, type OfflineEngine} from './offline-engine.ts';

/** The app-owned native engine; hosts without it (unit hosts, older builds) get an inert fallback. */
export function loadOfflineEngine(): OfflineEngine {
  try {return requireNativeModule<OfflineEngine>('SlaxOfflineEngine');} catch {return unavailableOfflineEngine();}
}
