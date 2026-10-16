import {getAnalytics, logEvent, setUserId, setUserProperty} from '@react-native-firebase/analytics';
import {getCrashlytics, recordError, setUserId as setCrashlyticsUserId} from '@react-native-firebase/crashlytics';
import type {FirebaseSink} from './core.ts';

/** Firebase configuration remains a native build input; SDK failures are handled by the collector. */
export const firebaseSink: FirebaseSink = {
  logEvent: (name, params) => logEvent(getAnalytics(), name, params),
  setUserId: userId => setUserId(getAnalytics(), userId),
  setUserProperty: async (name, value) => {await setUserProperty(getAnalytics(), name, value);},
  setCrashlyticsUserId: async userId => {await setCrashlyticsUserId(getCrashlytics(), userId ?? '');},
  recordError: error => recordError(getCrashlytics(), error),
};
