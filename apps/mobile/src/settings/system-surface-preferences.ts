import type {PreferenceValues} from '../data/preferences';

/** A missing snapshot is still loading; unset keys in a loaded snapshot default on. */
export function systemSurfacePreferences(settings: PreferenceValues | null) {
  return {
    discovery: settings !== null && (settings.system_discovery_enabled ?? true) === true,
    donations: settings !== null && (settings.system_donations_enabled ?? true) === true,
  };
}
