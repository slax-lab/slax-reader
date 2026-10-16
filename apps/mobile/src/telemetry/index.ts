import {useReadingMobile, type MobileContextValue} from '../runtime';
import {loadLegacyBridge} from '../data/native-storage.ts';
import {createMobileTelemetry, type MobileTelemetry} from './core.ts';
import {firebaseSink} from './firebase.ts';

export * from './core.ts';
const collectors = new WeakMap<MobileContextValue['runtime'], {telemetry: MobileTelemetry; locale: string}>();
/** Navigation, authentication, and reader actions share the runtime's device identity and SDKs. */
export function telemetryFor(context: MobileContextValue): MobileTelemetry {
  if (context.telemetryOverride) return context.telemetryOverride;
  let entry = collectors.get(context.runtime);
  if (!entry) {
    const locale = {value: context.locale};
    const telemetry = createMobileTelemetry({
      preferences: context.runtime.preferences, api: context.api, platform: context.config.platform,
      captureRequestScope: () => context.sessions.captureRequestScope(),
      version: `${context.config.version} (${context.config.buildNumber})`, locale: () => locale.value,
      generateIdentifier: () => loadLegacyBridge().newIdentifier(), firebase: firebaseSink,
    });
    entry = {telemetry, get locale() {return locale.value;}, set locale(value) {locale.value = value as typeof locale.value;}};
    collectors.set(context.runtime, entry);
  }
  entry.locale = context.locale;
  return entry.telemetry;
}
export function useTelemetry(): MobileTelemetry {return telemetryFor(useReadingMobile());}
