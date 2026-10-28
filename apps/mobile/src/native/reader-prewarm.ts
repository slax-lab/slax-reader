import {Platform} from 'react-native';
import {requireNativeModule} from 'expo';
import {mobileConfig} from '../config';
import {readerImageProxyOrigins, readerProtectedHosts} from '../reader/security.ts';

/** iOS: compiles the Reader content rules and starts WebKit processes once, with the same policy inputs as the Reader host. Android has no warmup. */
export async function prewarmReaderHost(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await requireNativeModule<{prewarmReader(protectedHosts: string[], imageProxyOrigins: string[]): Promise<void>}>('SlaxPlatform')
    .prewarmReader(readerProtectedHosts(mobileConfig), readerImageProxyOrigins(mobileConfig));
}
