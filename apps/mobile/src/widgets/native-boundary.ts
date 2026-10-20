import {requireNativeModule} from 'expo';
import {Linking, Platform} from 'react-native';
import {createReadingActivityFactory, createReadingActivityPort} from './reading-activity.tsx';
import type {WidgetSnapshot, WidgetSnapshotPort} from './controller.ts';
import type {WidgetNativeBoundary} from './adapters.ts';

type SlaxWidgetModule = {
  nextVersion(): Promise<number>;
  publishSnapshot(snapshot: WidgetSnapshot): Promise<boolean>;
  reloadWidgets(): Promise<void>;
};

function parseWidgetRoute(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'slaxreader:' || url.hostname !== 'widget' || url.pathname !== '') return null;
    const id = url.searchParams.get('bookmarkId');
    return id && /^b-[a-f0-9]{64}$/.test(id) ? id : null;
  } catch {return null;}
}

/** Returns undefined in fixture/unsupported hosts where the app-owned native bridge is absent. */
export function createWidgetNativeBoundary(): WidgetNativeBoundary | undefined {
  let native: SlaxWidgetModule;
  try {native = requireNativeModule<SlaxWidgetModule>('SlaxWidgetBridge');} catch {return undefined;}
  const snapshots: WidgetSnapshotPort = {
    nextVersion: () => native.nextVersion(),
    publish: snapshot => native.publishSnapshot(snapshot),
    revoke: async snapshot => {
      if (!await native.publishSnapshot(snapshot)) throw new Error('Widget revoke was rejected by the native version fence');
    },
    reload: () => native.reloadWidgets(),
  };
  const activity = createReadingActivityPort(createReadingActivityFactory(), () => Platform.OS === 'ios' && Number(Platform.Version) >= 16.2);
  return {
    ...snapshots,
    ...activity,
    addRouteListener(listener) {
      const subscription = Linking.addEventListener('url', ({url}) => {
        const id = parseWidgetRoute(url);
        if (id) listener(id);
      });
      return {remove: () => subscription.remove()};
    },
    async getInitialRoute() {return parseWidgetRoute((await Linking.getInitialURL()) ?? null);},
  };
}
