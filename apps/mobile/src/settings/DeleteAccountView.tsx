import React from 'react';
import type {RefObject} from 'react';
import {StyleSheet, View} from 'react-native';
import {WebView, type WebViewProps} from 'react-native-webview';
import {ScreenSurface, SourceButton, SourceDialog, SourceText, TextAction} from '../components';
import type {createTranslator} from '../i18n';
import {mobileColors as C} from '../theme';
import type {DeleteAccountState} from './useDeleteAccountState';

export interface DeleteAccountViewProps {
  t: ReturnType<typeof createTranslator>;
  state: DeleteAccountState;
  web: RefObject<WebView<unknown> | null>;
  notice: Pick<WebViewProps, 'source' | 'onLoadStart' | 'onError' | 'onHttpError' | 'onLoad' | 'onMessage' | 'onScroll' | 'onShouldStartLoadWithRequest'>;
}

export function DeleteAccountView({t, state, web, notice}: DeleteAccountViewProps) {
  return (
    <ScreenSurface sourceAppBar>
      <WebView<unknown> ref={web} {...notice} style={styles.notice} />
      <View style={styles.footer}>
        <SourceButton
          label={t('delete_account_button')}
          disabled={!state.canDelete}
          busy={state.busy}
          tone="surface"
          destructive
          onPress={state.askConfirmation}
        />
      </View>
      <SourceDialog
        visible={state.confirm}
        onDismiss={state.dismissConfirmation}
        title={t('delete_account_confirm_title')}
        actions={<>
          <TextAction label={t('btn_cancel')} color={C.bodyText} onPress={state.dismissConfirmation} />
          <TextAction label={t('delete_account_confirm_button')} color={C.danger} disabled={state.busy} onPress={() => void state.remove()} />
        </>}
      >
        <SourceText>{t('delete_account_confirm_message')}</SourceText>
      </SourceDialog>
      <SourceDialog
        visible={state.error !== null}
        dismissible={false}
        onDismiss={state.dismissError}
        title={t('delete_account_error_title')}
        actions={<TextAction label={t('btn_ok')} color={C.bodyText} onPress={state.dismissError} />}
      >
        <SourceText>{state.error}</SourceText>
      </SourceDialog>
    </ScreenSurface>
  );
}

const styles = StyleSheet.create({
  notice: {flex: 1, backgroundColor: C.background},
  footer: {paddingVertical: 30, paddingHorizontal: 24},
});
