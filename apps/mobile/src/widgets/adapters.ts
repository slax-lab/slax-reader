import type {MobileDataRuntime} from '../data/runtime';
import type {SystemEntryRouter} from '../system-actions/entry-router';
import {WidgetRuntimeCoordinator, type WidgetBoundary} from './runtime-coordinator';
import type {WidgetOwner} from './controller.ts';
import {WIDGET_ROUTE_MAP_KEY, type WidgetRouteMap} from './route-map';

export type WidgetNativeBoundary = WidgetBoundary & {
  addRouteListener?(listener: (bookmarkId: string) => void): {remove(): void};
  getInitialRoute?(): Promise<string | null>;
};

export function createWidgetRuntime(runtime: MobileDataRuntime, boundary: WidgetNativeBoundary, router: SystemEntryRouter) {
  const coordinator = new WidgetRuntimeCoordinator(
    boundary,
    async (map: WidgetRouteMap) => {await runtime.preferences.update(values => {values[WIDGET_ROUTE_MAP_KEY] = JSON.stringify(map);});},
    async (owner: WidgetOwner, bookmarkId: string) => {
      const session = runtime.sessions.getSnapshot();
      if (session.status !== 'authenticated' || session.session.userId !== owner.userId || runtime.api.options.baseUrl !== owner.origin || runtime.getNativeResourceOwner() !== owner.generation) {
        throw new Error('The active library changed before the read could be saved');
      }
      const repositories = runtime.getRepositories();
      if (!repositories) throw new Error('The admitted library is unavailable');
      await repositories.updateBookmark(bookmarkId, {isRead: 1});
    },
  );
  let sequence = 0;
  let subscription: {remove(): void} | undefined;
  return {coordinator,
    activate() {
      coordinator.activate();
      subscription?.remove();
      const receive = (bookmarkId: string) => {void router.receive([{id: `widget-${Date.now()}-${++sequence}`, name: 'openBookmark', params: {bookmarkId}, createdAt: Date.now()}]);};
      subscription = boundary.addRouteListener?.(receive);
      void boundary.getInitialRoute?.().then(bookmarkId => {if (bookmarkId) receive(bookmarkId);}).catch(() => undefined);
    },
    dispose() {subscription?.remove(); subscription = undefined; coordinator.dispose();},
  };
}
