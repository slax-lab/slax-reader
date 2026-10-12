import React, {useEffect, useRef, useState} from 'react';
import {Platform, Pressable, Text, View} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {createExpoStore} from '../../src/payments/expo-store';
import {PaymentController, type StorePort, type StorePurchase} from '../../src/payments/controller.ts';
import {PreferenceStore, type PreferenceSnapshot} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {STOREKIT_FIXTURE_INPUT, STOREKIT_FIXTURE_PREFLIGHT, STOREKIT_FIXTURE_REPORT, assertUnchangedStoreKitRun, validateStoreKitInput, validateStoreKitPreflight, type StoreKitFixtureInput} from './contract.ts';

/** No normal runtime, legacy storage, telemetry or Firebase sink is imported. */
export default function NativeStoreKitFixtureApp() {
  const [state, setState] = useState('waiting-native-preflight'), [error, setError] = useState('');
  const [controller, setController] = useState<PaymentController|null>(null), [input, setInput] = useState<StoreKitFixtureInput|null>(null);
  const [counts, setCounts] = useState({restores: 0, entitlements: 0});
  const reportCurrent = useRef<(() => void)|undefined>(undefined);
  useEffect(() => {
    let active = true, revoked = false, payments: PaymentController|undefined, unsubscribe: (() => void)|undefined;
    const file = (name: string) => new File(Paths.document, name);
    const begin = async () => {
      if (!__DEV__ || Platform.OS !== 'ios' || process.env.EXPO_PUBLIC_SLAX_STOREKIT_FIXTURE !== '1') throw new Error('Local StoreKit fixture was not selected');
      const documents = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/$/, '');
      const request = validateStoreKitInput(JSON.parse(await file(STOREKIT_FIXTURE_INPUT).text()), documents);
      // A native XCTest must first calibrate a synthetic transaction in Xcode's local environment.
      const preflight = validateStoreKitPreflight(JSON.parse(await file(STOREKIT_FIXTURE_PREFLIGHT).text()), request);
      let snapshot: PreferenceSnapshot = {revision: 0, values: {auth_token: 'fixture-auth-token-NOT-A-REAL-CREDENTIAL', user_id: 'synthetic-storekit-user'}};
      const preferences = new PreferenceStore({async read() {return {revision: snapshot.revision, values: {...snapshot.values}};}, async compareAndSwap(revision, values) {if (revision !== snapshot.revision) return false; snapshot = {revision: revision + 1, values: {...values}}; return true;}});
      const sessions = new SessionController(preferences, {enter: async () => {}, leave: async () => {}}); await sessions.restore();
      const native = createExpoStore(), verifiedReceipts = new Set<string>();
      let callbacks = 0, finished = 0, verificationCalls = 0, restores = 0;
      const assertLive = () => {
        if (!active || revoked) throw new Error('Local fixture stopped');
        assertUnchangedStoreKitRun(JSON.parse(file(STOREKIT_FIXTURE_INPUT).textSync()), JSON.parse(file(STOREKIT_FIXTURE_PREFLIGHT).textSync()), request, preflight, documents);
      };
      const revoke = () => {revoked = true; if (active) setError('Native transaction failed the isolated Xcode guard'); void payments?.stop().catch(() => undefined);};
      const inspect = (purchase: StorePurchase) => {
        assertLive();
        const local = purchase as StorePurchase & {environmentIOS?: string|null; appBundleIdIOS?: string|null};
        if (purchase.productId !== request.monthlyProduct || purchase.purchaseState !== 'pending' && (local.environmentIOS !== 'Xcode' || local.appBundleIdIOS !== request.bundleIdentifier)) throw new Error('An unrelated or non-Xcode transaction is prohibited');
        if (purchase.purchaseToken) verifiedReceipts.add(purchase.purchaseToken);
      };
      const store: StorePort = {
        async start(onPurchase, onError) {assertLive(); await native.start(value => {try {inspect(value); callbacks++; onPurchase(value);} catch {revoke();}}, error => {try {assertLive(); onError(error);} catch {revoke();}}); assertLive();},
        async products(ids) {
          assertLive(); const sdk = await import('expo-iap'); const catalog = await sdk.fetchProducts({skus: [request.monthlyProduct, request.calibrationProduct], type: 'all'});
          assertLive(); if (!catalog || catalog.length !== 2 || new Set(catalog.map(value => value.id)).size !== 2 || !catalog.some(value => value.id === request.monthlyProduct) || !catalog.some(value => value.id === request.calibrationProduct)) throw new Error('Actual adapter catalog differs from the native local preflight');
          await native.products(ids); assertLive();
        },
        async purchase(value) {assertLive(); if (value.productId !== request.monthlyProduct || value.orderId !== request.orderId || value.offer) throw new Error('Only this synthetic local order without signed offers is permitted'); await native.purchase(value); assertLive();},
        async finish(value) {inspect(value); await native.finish(value); assertLive(); finished++;},
        async restore() {assertLive(); const values = await native.restore(); assertLive(); values.forEach(inspect); restores++; return values;},
        async pending() {assertLive(); const values = await native.pending(); assertLive(); values.forEach(inspect); return values;},
        async entitlements() {assertLive(); const values = await native.entitlements(); assertLive(); values.forEach(inspect); return values;},
        stop: () => native.stop(),
      };
      payments = new PaymentController(store, sessions, preferences, async params => {
        assertLive(); verificationCalls++;
        // The local verifier tests finishing/order plumbing; it is never an Apple/backend receipt verdict.
        return {ok: params.product_id === request.monthlyProduct && params.order_id === request.orderId && verifiedReceipts.has(params.jws_representation)};
      });
      const current = payments;
      const record = () => {
        if (!active || revoked) return;
        assertLive();
        const next = current.getSnapshot().status; setState(next);
        setCounts({restores, entitlements: current.getPurchasedIds().length});
        file(STOREKIT_FIXTURE_REPORT).write(JSON.stringify({kind: 'slax-controlled-local-storekit-report', version: 1, device: request.device, runId: request.runId, nonce: request.nonce, recordedAt: Date.now(), nativeFrameworkPreflight: preflight.environment, state: next, actualNativeCallbacks: callbacks, actualNativeFinishes: finished, actualNativeRestores: restores, localVerificationCalls: verificationCalls, currentEntitlements: current.getPurchasedIds(), networkRequestsForwarded: 0, realAppleAccountUsed: false, receiptOrJwtPersisted: false, nativeLegacyPreferenceProof: false, appleBackendReceiptValidation: false, publisherSigned: false}, null, 2));
      };
      unsubscribe = current.subscribe(() => {try {record();} catch {revoke();}});
      await current.start([request.monthlyProduct]);
      assertLive(); if (current.getSnapshot().status === 'error') throw new Error('The actual local adapter did not initialize');
      if (!active) {unsubscribe(); await current.stop(); return;}
      setInput(request); setController(current); record();
      // Restore may retain the same status, so its awaited completion records counters explicitly.
      reportCurrent.current = () => {try {record();} catch {revoke();}};
    };
    void begin().catch(() => {revoked = true; void payments?.stop().catch(() => undefined); if (active) setError('Local StoreKit preflight did not pass; no purchase is permitted');});
    return () => {active = false; revoked = true; reportCurrent.current = undefined; unsubscribe?.(); void payments?.stop().catch(() => undefined);};
  }, []);
  const execute = (action: () => Promise<void>) => {void action().then(() => reportCurrent.current?.()).catch(() => setError('Controlled local StoreKit action failed'));};
  return <View style={{flex: 1, padding: 32, justifyContent: 'center'}}><Text testID="storekit-fixture-state">{state}</Text><Text testID="storekit-fixture-error">{error}</Text>
    <Text testID="storekit-fixture-native-restores">{counts.restores}</Text><Text testID="storekit-fixture-active-entitlements">{counts.entitlements}</Text>
    {controller && input && !error ? <><Pressable accessibilityRole="button" testID="storekit-fixture-purchase" onPress={() => execute(() => controller.purchase({productId: input.monthlyProduct, orderId: input.orderId}))}><Text>Purchase local synthetic subscription</Text></Pressable>
      <Pressable accessibilityRole="button" testID="storekit-fixture-restore" onPress={() => execute(() => controller.restore())}><Text>Restore local synthetic subscription</Text></Pressable>
      <Pressable accessibilityRole="button" testID="storekit-fixture-entitlements" onPress={() => execute(() => controller.refreshEntitlements())}><Text>Refresh local entitlements</Text></Pressable></> : null}
  </View>;
}
