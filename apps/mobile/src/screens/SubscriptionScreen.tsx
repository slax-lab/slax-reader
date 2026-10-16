import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ActivityIndicator, Alert, Modal, Platform, StyleSheet, Text, View} from 'react-native';
import {usePreventRemove} from '@react-navigation/native';
import {WebView} from 'react-native-webview';
import {useMobile} from '../runtime';
import {parsePurchaseMessage} from '../payments/controller';
import {mobileColors as C} from '../theme';
import {useTelemetry} from '../telemetry';
import {fixtureDocument} from '../native/fixture-document';

export function SubscriptionScreen() {
  const {payments: controller, webSession, acquireWebSession, api, runtime, nativeResourceOwner, sessions, config, fixtureOnly} = useMobile();
  useEffect(() => acquireWebSession?.(), [acquireWebSession]);
  useEffect(() => {
    if (Platform.OS !== 'ios' || fixtureOnly || !nativeResourceOwner) return;
    const request = new AbortController(), scope = sessions.captureRequestScope();
    void controller.loadProducts(async () => {
      const result = await api.getIAPProductIds(request.signal); scope.assertCurrent(); return result.products;
    }, () => !request.signal.aborted && runtime.getNativeResourceOwner() === nativeResourceOwner);
    return () => request.abort();
  }, [controller, api, runtime, nativeResourceOwner, sessions, fixtureOnly]);
  const telemetry = useTelemetry();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [loading, setLoading] = useState(true);
  const cookieReady = webSession.ready;
  const view = useRef<WebView>(null);
  const busy = state.status === 'purchasing' || state.status === 'checking' || state.status === 'pending';
  usePreventRemove(busy, () => undefined);
  useEffect(() => {
    if (webSession.error) Alert.alert('支付失败', webSession.error.message);
  }, [webSession.error]);
  useEffect(() => {
    if (state.status === 'success') Alert.alert('支付成功', '感谢您的订阅!', [{text: '确定', onPress: () => {controller.reset(); view.current?.reload();}}]);
    if (state.status === 'cancelled') Alert.alert('支付已取消', '您已取消本次支付', [{text: '确定', onPress: () => {controller.reset(); view.current?.reload();}}]);
    if (state.status === 'error') Alert.alert('支付失败', state.message, [{text: '确定', onPress: () => {controller.reset(); view.current?.reload();}}]);
  }, [state]);
  const url = `${config.webUrl}/subscription/inapp-purchase`;
  return <View style={{flex: 1, backgroundColor: C.background}}>
    {cookieReady && <WebView ref={view} source={fixtureOnly ? {html: fixtureDocument(fixtureOnly.subscriptionHtml ?? '<html><head></head><body><p>Controlled subscription fixture. Store accounts and external content are disabled.</p></body></html>'), baseUrl: url} : {uri: url}} sharedCookiesEnabled={!fixtureOnly} incognito={Boolean(fixtureOnly)} javaScriptEnabled allowsInlineMediaPlayback onLoadEnd={() => setLoading(false)}
      onShouldStartLoadWithRequest={(request: {url: string}) => !fixtureOnly || request.url === 'about:blank' || request.url === url}
      injectedJavaScriptBeforeContentLoaded={`window.NativeBridge={postMessage:function(data){window.ReactNativeWebView.postMessage(typeof data==='string'?data:JSON.stringify(data));}};window.webkit=window.webkit||{};window.webkit.messageHandlers=window.webkit.messageHandlers||{};window.webkit.messageHandlers.NativeBridge=window.NativeBridge;true;`}
      onMessage={event => {
        if (Platform.OS !== 'ios') return;
        try { if (new URL(event.nativeEvent.url).origin !== new URL(config.webUrl).origin) return; } catch { return; }
        try { const command = parsePurchaseMessage(event.nativeEvent.data); if (command) { telemetry.firebase('subscription', 'checkout_start', {gateway: 'apple_iap', plan_id: command.productId}); void controller.purchase(command).catch(error => Alert.alert('支付失败', error.message)); } }
        catch (error) { Alert.alert('支付失败', error instanceof Error ? error.message : 'Invalid purchase'); }
      }}/>} 
    {(loading || !cookieReady) && <View pointerEvents="none" style={styles.loading}><ActivityIndicator size="large" color={C.accent}/></View>}
    <Modal visible={busy} transparent animationType="fade" onRequestClose={() => undefined}><View style={styles.modal}><View style={styles.payment}><ActivityIndicator/><Text style={styles.paymentText}>{state.status === 'checking' ? '验证中...' : '处理中...'}</Text></View></View></Modal>
  </View>;
}
const styles = StyleSheet.create({loading: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center'}, modal: {flex: 1, backgroundColor: C.scrim, justifyContent: 'center', alignItems: 'center'}, payment: {width: 200, height: 200, borderRadius: 8, padding: 24, backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center', gap: 16}, paymentText: {fontSize: 16, color: C.text}});
