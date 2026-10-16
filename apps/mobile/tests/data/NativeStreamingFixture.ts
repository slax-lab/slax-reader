import {Platform} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {fetch as expoFetch} from 'expo/fetch';
import {createMobileApi, type AiEvent} from '../../src/data/api.ts';

const file = (path: string) => new File(`file://${encodeURI(path)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}

/** Actual SDK57 native transport, using the same injection as the normal production runtime. */
export async function runNativeStreamingFixture() {
  check(__DEV__ && ['ios', 'android'].includes(Platform.OS), 'Native stream verification requires the selected development fixture');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
  const request = JSON.parse(await file(`${directory}/native-stream-request.json`).text()) as {kind?: string; version?: number; device?: string; platform?: string; nonce?: string; origin?: string; requestedAt?: number};
  check(request.kind === 'slax-controlled-native-stream-request' && request.version === 1 && request.platform === Platform.OS && /^[0-9a-f-]{36}$/.test(request.nonce ?? '') && Number.isSafeInteger(request.requestedAt) && Number(request.requestedAt) > 0, 'Unrecognized native stream control');
  check(Platform.OS === 'android' ? /^emulator-\d+$/.test(request.device ?? '') : directory.includes(`/CoreSimulator/Devices/${request.device}/data/Containers/Data/Application/`), 'Only the selected controlled native device is allowed');
  const source = JSON.parse(await file(`${directory}/legacy-fixture-report.json`).text()) as {controlledFixture?: boolean; producer?: string; androidBundleId?: string; iosBundleId?: string};
  check(source.controlledFixture === true && source.producer === 'powersync-kotlin-1.14.1' && (Platform.OS === 'android' ? source.androidBundleId === 'com.slax.reader' : source.iosBundleId === 'app.slax.reader'), 'A genuine controlled synthetic sandbox is required');
  check(typeof request.origin === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(request.origin) && new URL(request.origin).origin === request.origin, 'Only the owned loopback stream origin is allowed');
  const session = {token: 'fixture-stream-token-NOT-A-REAL-CREDENTIAL', userId: 'synthetic-stream-user', refreshedAt: 0};
  const api = createMobileApi({baseUrl: request.origin, platform: Platform.OS as 'ios' | 'android', version: 'controlled-native-stream', fetch: expoFetch,
    sessions: {getSession: async () => session, clearIfMatches: async () => false}});
  const events: {receivedAt: number; event: AiEvent}[] = [];
  const timedStartedAt = Date.now();
  for await (const event of api.streamAi('overview', `stream-${request.nonce}`)) events.push({receivedAt: Date.now(), event});
  check(events.length === 3 && events[0]?.event.data?.overview === '真实流式首块' && events[1]?.event.data?.overview === '真实流式第二块' && events[2]?.event.type === 'done', 'Native transport lost split UTF-8 or the final unterminated line');
  check(events[1]!.receivedAt - events[0]!.receivedAt > 1000 && events[2]!.receivedAt - events[0]!.receivedAt > 2000, 'The native transport buffered the whole response instead of yielding timed chunks');
  const abort = new AbortController(), cancelledEvents: AiEvent[] = [];
  let abortedAt = 0, cancellationName = '';
  try {
    for await (const event of api.streamAi('outline', `stream-${request.nonce}`, abort.signal)) {cancelledEvents.push(event); abortedAt = Date.now(); abort.abort();}
  } catch (error) {cancellationName = error instanceof Error ? error.name : '';}
  check(cancelledEvents.length === 1 && cancellationName === 'AbortError', 'Actual native stream cancellation failed to stop after the first event');
  const report = {kind: 'slax-controlled-native-stream-report', version: 1, status: 'passed', platform: Platform.OS, device: request.device, nonce: request.nonce, requestedAt: request.requestedAt,
    transport: 'SDK57 expo/fetch as injected by normal createMobileDataRuntime', productionSlaxApiExecuted: true, actualNativeHttpStream: true,
    timedStartedAt, timedEvents: events, splitUtf8Preserved: true, finalUnterminatedLinePreserved: true, chunksYieldedBeforeResponseCompletion: true,
    cancelledAt: abortedAt, cancellationName, cancelledEventCount: cancelledEvents.length,
    rnSignalThrowIfAbortedAvailable: typeof (abort.signal as AbortSignal & {throwIfAborted?: () => void}).throwIfAborted === 'function',
    credentials: 'Fixed explicitly synthetic fixture value; no persisted/operator session used', databaseOrPreferencesOpened: false,
    formalBackendContacted: false, visibleAiUiAcceptance: false, publisherRelease: false};
  file(`${directory}/native-stream-report.json`).write(JSON.stringify(report, null, 2));
  return report;
}
