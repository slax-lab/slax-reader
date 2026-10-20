import React, {useEffect, useState, useSyncExternalStore} from 'react';
import type {AppIntentInvocation} from 'expo-app-intents';
import {Platform, View} from 'react-native';
import {SourceButton, SourceDialog, SourceText} from '../components/SourceUI';
import {mobileColors as C, mobileTypography as T} from '../theme';
import {SaveURLController, type SystemActionOwner} from './controller';
import type {SystemEntryRouter} from './entry-router';

type AppIntentBindingPort = {isAvailable(): boolean; useAppIntents(handler: (pending: AppIntentInvocation[], next: AppIntentInvocation | null) => void | Promise<void>): void};
function SaveIntentBinding({controller, router, appIntents}: {controller: SaveURLController; router: SystemEntryRouter; appIntents: AppIntentBindingPort}) {
  appIntents.useAppIntents(async pending => {await controller.receive(pending); await router.receive(pending);});
  return null;
}

export function SaveURLHost({controller, router, owner, ready, appIntents, t}: {controller: SaveURLController; router: SystemEntryRouter; owner: SystemActionOwner | null; ready: boolean; appIntents?: AppIntentBindingPort; t(key: string, args?: Record<string, string>): string}) {
  const receipts = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const entryIssue = useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot);
  useEffect(() => {controller.activate(); void controller.receive([]); return () => controller.dispose();}, [controller]);
  const binding = Platform.OS === 'ios' && appIntents?.isAvailable() ? <SaveIntentBinding controller={controller} router={router} appIntents={appIntents}/> : null;
  if (entryIssue) return <>{binding}<SourceDialog visible title={t('system_entry_unavailable_title')} onDismiss={() => undefined} testID="system-entry-unavailable" dismissible={false}>
    <SourceText style={{...T.body, color: C.text, marginBottom: 16}}>{t('system_entry_unavailable_message')}</SourceText>
    <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}><SourceButton label={t('system_save_discard')} onPress={() => void router.discardUnavailable(entryIssue.id)} testID="system-entry-discard"/></View>
  </SourceDialog></>;
  if (Platform.OS !== 'ios' || !appIntents?.isAvailable() || !ready || !owner) return binding;
  const visible = receipts.filter(item => item.status !== 'complete' && item.status !== 'discarded' && (!item.owner || item.owner.userId === owner.userId && item.owner.origin === owner.origin));
  if (!visible.length) return binding;
  const item = visible[0];
  if (!item) return binding;
  const unclaimed = !item.owner && item.status !== 'invalid';
  const claim = () => void controller.claim(item.id);
  const discard = () => void controller.discard(item.id);
  const retry = () => void controller.retry(item.id);
  return <>{binding}<SourceDialog visible title={t('system_save_title')} onDismiss={() => undefined} testID="system-save-review" dismissible={false}>
    <SourceText style={{...T.body, color: C.text, marginBottom: 10}}>{unclaimed ? t('system_save_claim_message') : item.status === 'invalid' ? t('system_save_invalid') : item.status === 'failed' ? t('system_save_failed') : t('system_save_pending')}</SourceText>
    {item.title ? <SourceText numberOfLines={2} style={{...T.metadata, color: C.mutedText, marginBottom: 12}}>{item.title}</SourceText> : null}
    <SourceText numberOfLines={2} style={{...T.metadata, color: C.mutedText}}>{item.url}</SourceText>
    <View style={{flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 18}}>
      {unclaimed ? <SourceButton label={t('system_save_claim')} onPress={claim} testID="system-save-claim"/> : item.status === 'failed' ? <SourceButton label={t('system_save_retry')} onPress={retry} testID="system-save-retry"/> : null}
      <SourceButton label={t('system_save_discard')} onPress={discard} tone="surface" testID="system-save-discard"/>
    </View>
  </SourceDialog></>;
}
