import React, {useLayoutEffect} from 'react';
import type {MobileScreenProps} from '../navigation/types';
import {useMobile} from '../runtime';
import {usePdfLab} from '../pdf/usePdfLab';
import {useAccountScope} from '../settings/account-scope';
import {useRssLab} from '../settings/useRssLab';
import {useSettingsState} from '../settings/useSettingsState';
import {SettingsView} from '../settings/SettingsView';

export function SettingsScreen({navigation}: MobileScreenProps<'Settings'>) {
  const mobile = useMobile();
  const {t, locale, settings, preferences, api} = mobile;
  const scope = useAccountScope({
    ...mobile,
    apiOrigin: mobile.config.apiUrl,
    fixture: Boolean(mobile.fixtureOnly),
  });
  const state = useSettingsState(settings, preferences, scope);
  const rss = useRssLab(api, scope);
  const pdf = usePdfLab();
  useLayoutEffect(() => {
    navigation.setOptions({title: t('setting_title'), headerTitleAlign: 'center'});
  }, [navigation, t]);

  return <SettingsView t={t} locale={locale} state={state} rss={rss} pdf={pdf} onDeleteAccount={() => navigation.navigate('DeleteAccount')} />;
}
