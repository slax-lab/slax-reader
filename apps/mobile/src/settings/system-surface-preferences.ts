import type {PreferenceValues} from '../data/preferences';

/** A missing snapshot is still loading; unset keys in a loaded snapshot default on. */
export function systemSurfacePreferences(settings: PreferenceValues | null) {
  return {
    discovery: settings !== null && (settings.system_discovery_enabled ?? true) === true,
    donations: settings !== null && (settings.system_donations_enabled ?? true) === true,
  };
}

/** Keep the App Intents deployment floor separate from Spotlight's IndexedEntity API. */
export function systemSurfaceCapabilities(platform: string, version: string | number, nativeAvailable: boolean) {
  const [major = 0, minor = 0] = String(version).split('.').map(Number);
  const intents = nativeAvailable && platform === 'ios' && (major > 16 || major === 16 && minor >= 4);
  return {intents, donations: intents, discovery: intents && major >= 18};
}
