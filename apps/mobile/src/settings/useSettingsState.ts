import {useCallback, useEffect, useRef, useState} from 'react';
import type {PreferenceStore, PreferenceValues} from '../data/preferences';
import type {MobileLocale} from '../i18n';
import type {AccountScope} from './account-scope';

export interface SettingsState {
  cacheCount: number;
  images: boolean;
  language: boolean;
  error: string | null;
  setCacheCount(value: number): void;
  toggleImages(): void;
  showLanguage(): void;
  dismissLanguage(): void;
  selectLanguage(value: MobileLocale): void;
  dismissError(): void;
}

export function useSettingsState(
  settings: PreferenceValues,
  preferences: Pick<PreferenceStore, 'update'>,
  scope: AccountScope,
): SettingsState {
  const [language, setLanguage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<object | null>(null);
  useEffect(() => {
    const generation = {};
    lifetime.current = generation;
    setLanguage(false);
    setError(null);
    return () => { if (lifetime.current === generation) lifetime.current = null; };
  }, [preferences, scope]);

  const save = useCallback((key: string, value: string | number) => {
    const generation = lifetime.current;
    const current = () => generation !== null && lifetime.current === generation && scope.isCurrent();
    if (!current()) return;
    void preferences.update(next => {
      if (current()) next[key] = value;
    }).catch(reason => {
      if (current()) setError(String(reason?.message ?? reason));
    });
  }, [preferences, scope]);
  const images = (settings.download_images ?? 1) === 1;

  return {
    cacheCount: typeof settings.cache_count === 'number' ? settings.cache_count : 50,
    images,
    language,
    error,
    setCacheCount: value => save('cache_count', value),
    toggleImages: () => save('download_images', images ? 0 : 1),
    showLanguage: () => setLanguage(true),
    dismissLanguage: () => setLanguage(false),
    selectLanguage: value => {
      save('user_language', value);
      setLanguage(false);
    },
    dismissError: () => setError(null),
  };
}
