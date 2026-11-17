import type { SnapshotPanelId } from '~/components/Snapshot/panels'

export interface ReaderNavigation {
  path: string
  initial: boolean
  history: boolean
  explicit: boolean
  interacted: boolean
  stop: () => void
}

declare global {
  interface Window {
    __slaxReaderStartup?: {
      navigation: ReaderNavigation
      historyPath: string | null
      start: (path: string, history: boolean) => void
      takePanel: (path: string) => SnapshotPanelId | null
    }
  }
}

// This small first-party script runs before the application bundle can be delayed.
// Keep it self-contained: it records intent and never moves the viewport or reads user data.
export const readerStartupScript = String.raw`(() => {
  const state = { navigation: null, historyPath: null, start, takePanel };
  let pendingPanel = null;
  let stopPanel = () => {};
  function takePanel(path) {
    if (path !== state.navigation.path) return null;
    const panel = pendingPanel;
    stopPanel();
    return panel;
  }
  function start(destination, history) {
    const url = new URL(destination, location.href);
    const path = url.pathname;
    stopPanel();
    if (state.navigation) state.navigation.stop();
    const initial = state.navigation === null;
    const navigation = state.navigation = {
      path, initial, history,
      explicit: !!url.hash || url.searchParams.has('highlight'),
      interacted: initial && scrollY > 0,
      stop: () => {}
    };
    if (!/^\/b\/[^/]+\/?$/.test(path)) return;
    const panelClick = event => {
      const button = event.target.closest?.('button[data-snapshot-panel]');
      const panel = button?.dataset.snapshotPanel;
      if (!['ai', 'transcript', 'chat', 'comment'].includes(panel)) return;
      if (button.closest('[data-reader-path]')?.dataset.readerPath !== path) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingPanel = panel;
      document.documentElement.dataset.slaxPendingPanel = panel;
    };
    addEventListener('click', panelClick, true);
    stopPanel = () => {
      removeEventListener('click', panelClick, true);
      pendingPanel = null;
      delete document.documentElement.dataset.slaxPendingPanel;
    };
    const abort = () => { navigation.interacted = true; };
    const key = event => {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) abort();
    };
    const scroll = () => { if (scrollY > 0) abort(); };
    addEventListener('wheel', abort, { passive: true });
    addEventListener('touchmove', abort, { passive: true });
    addEventListener('keydown', key);
    if (initial) addEventListener('scroll', scroll, { passive: true });
    navigation.stop = () => {
      removeEventListener('wheel', abort);
      removeEventListener('touchmove', abort);
      removeEventListener('keydown', key);
      removeEventListener('scroll', scroll);
    };
  }
  window.__slaxReaderStartup = state;
  start(location.href, performance.getEntriesByType('navigation')[0]?.type === 'back_forward');
  addEventListener('popstate', () => { state.historyPath = location.pathname; });
})();`

type ScrollRoute = { path: string; hash: string }

export function shouldScrollReaderToTop(to: ScrollRoute, from: { matched: readonly unknown[] }) {
  if (from.matched.length || to.hash || !/^\/b\/[^/]+\/?$/.test(to.path)) return true
  return typeof document !== 'undefined' && !!document.querySelector('.bookmark-detail.is-pdf')
}

export function cancelReaderRestore() {
  window.dispatchEvent(new Event('slax:reader-navigation'))
}
