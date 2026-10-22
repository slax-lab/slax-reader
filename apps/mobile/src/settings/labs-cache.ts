import type {PreferenceStore} from '../data/preferences';

export type LabFeature = {key: string; enabled: boolean};

const LABS_KEY = '_slax_labs_features_v1';

export async function readLabsCache(preferences: Pick<PreferenceStore, 'read'>): Promise<LabFeature[] | null> {
  const value = (await preferences.read())[LABS_KEY];
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as {features?: unknown};
    if (!Array.isArray(parsed.features)) return null;
    const features = parsed.features.filter((item): item is LabFeature => (
      !!item && typeof item === 'object' &&
      typeof (item as LabFeature).key === 'string' &&
      typeof (item as LabFeature).enabled === 'boolean'
    ));
    return features.length ? features : null;
  } catch {
    return null;
  }
}

export async function writeLabsCache(preferences: Pick<PreferenceStore, 'update'>, features: LabFeature[]): Promise<void> {
  await preferences.update(values => {
    values[LABS_KEY] = JSON.stringify({features});
  });
}

export function labEnabled(features: LabFeature[] | null, key: string): boolean | null {
  const feature = features?.find(item => item.key === key);
  return feature ? feature.enabled : null;
}
