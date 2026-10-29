import React, {useLayoutEffect, useSyncExternalStore} from 'react';
import type {MobileScreenProps} from '../navigation/types';
import {useMobile, useMobileSettings} from '../runtime';
import {usePdfLab} from '../pdf/usePdfLab';
import {useAccountScope} from '../settings/account-scope';
import {useRssLab} from '../settings/useRssLab';
import {useSettingsState} from '../settings/useSettingsState';
import {SettingsView} from '../settings/SettingsView';

export function SettingsScreen({navigation}: MobileScreenProps<'Settings'>) {
  const mobile = useMobile(), settings = useMobileSettings();
  const {t, locale, preferences, api, systemIntentsAvailable, systemDiscoveryAvailable} = mobile;
  const scope = useAccountScope({
    ...mobile,
    apiOrigin: mobile.config.apiUrl,
    fixture: Boolean(mobile.fixtureOnly),
  });
  const state = useSettingsState(settings, preferences, scope);
  const systemSurfaces = mobile.systemSurfaces;
  const systemSurfacesReady = mobile.credentialState?.status === 'ready';
  const systemSurfaceFailed = useSyncExternalStore(systemSurfaces?.subscribe ?? (() => () => {}), systemSurfaces?.getSnapshot ?? (() => false), systemSurfaces?.getSnapshot ?? (() => false));
  const rss = useRssLab(api, scope, preferences);
  const pdf = usePdfLab();
  useLayoutEffect(() => {
    navigation.setOptions({title: t('setting_title'), headerTitleAlign: 'center'});
  }, [navigation, t]);

  return <SettingsView t={t} locale={locale} state={state} rss={rss} pdf={pdf} showAdaptivePdfPrototype={Boolean(__DEV__ && mobile.fixtureOnly)} systemSurfaceFailed={systemSurfaceFailed} systemSurfaceAvailable={systemIntentsAvailable} systemDiscoveryAvailable={systemDiscoveryAvailable}
    onRetrySystemSurfaces={() => {void systemSurfaces?.reconcile(state.systemDiscovery && systemDiscoveryAvailable === true, state.systemDonations && systemIntentsAvailable === true, systemSurfacesReady).then(() => systemSurfaces?.retryPendingDonations());}}
    onDeleteAccount={() => navigation.navigate('DeleteAccount')} />;
}
