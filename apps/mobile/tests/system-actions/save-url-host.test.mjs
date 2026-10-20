import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import {SaveURLController} from '../../src/system-actions/controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('mounted App Intent host presents explicit claim and updates after save completion', async t => {
  await withNativeHost(async host => {
    const journal = {items: [], async read() {return structuredClone(this.items);}, async write(items) {this.items = structuredClone(items);}};
    let owner = {userId: 'u', origin: 'https://api.example', generation: 'g'}, saved = 0;
    const controller = new SaveURLController({journal, currentOwner: () => owner, ready: () => true, removeInvocation: async () => {}, save: async () => {saved++;}});
    const ui = {
      SourceText: ({children, testID}) => React.createElement('div', {'data-testid': testID}, children),
      SourceButton: ({label, onPress, testID}) => React.createElement('button', {'data-testid': testID, onClick: onPress}, label),
      SourceDialog: ({visible, children, title, testID}) => visible ? React.createElement('section', {'data-testid': testID}, title, children) : null,
    };
    const native = {...host.native, Platform: {OS: 'ios'}};
    const {SaveURLHost} = await loadComponent('../../src/system-actions/SaveURLHost.tsx', {
      react: React, 'react-native': native,
      '../components/SourceUI': ui, '../theme': {mobileColors: {text: '#111', mutedText: '#555'}, mobileTypography: {body: {}, metadata: {}}},
    });
    const {withRenderedElement} = await import('../reader/parity-host.mjs');
    const router = {subscribe: () => () => {}, getSnapshot: () => null, receive: async () => {}, discardUnavailable: async () => {}};
    const appIntents = {isAvailable: () => true, useAppIntents(handler) {React.useEffect(() => {void handler([{id: 'mounted-1', name: 'saveURL', params: {url: 'https://example.com'}, createdAt: 1}], null);}, []);}};
    await withRenderedElement(React.createElement(React.StrictMode, null, React.createElement(SaveURLHost, {controller, router, owner, ready: true, appIntents, t: key => key})), async container => {
      await tick(); assert.ok(container.querySelector('[data-testid="system-save-claim"]'));
      await React.act(async () => container.querySelector('[data-testid="system-save-claim"]').click());
      await tick(); await tick();
      assert.equal(saved, 1); assert.equal(journal.items[0].status, 'complete');
    });
    controller.dispose();
  });
});

test('cold signed-out receipt stays queued and nonblocking until admitted owner explicitly claims', async () => {
  await withNativeHost(async host => {
    const owner = {userId: 'u', origin: 'https://api.example', generation: 'g'};
    const journal = {items: [{id: 'cold-1', url: 'https://example.com', title: '', status: 'pending', owner: null}], async read() {return structuredClone(this.items);}, async write(items) {this.items = structuredClone(items);}};
    let currentOwner = null, saved = 0, setReady;
    const controller = new SaveURLController({journal, currentOwner: () => currentOwner, ready: () => Boolean(currentOwner), removeInvocation: async () => {}, save: async () => {saved++;}});
    const ui = {
      SourceText: ({children, testID}) => React.createElement('div', {'data-testid': testID}, children),
      SourceButton: ({label, onPress, testID}) => React.createElement('button', {'data-testid': testID, onClick: onPress}, label),
      SourceDialog: ({visible, children, title, testID}) => visible ? React.createElement('section', {'data-testid': testID}, title, children) : null,
    };
    const {SaveURLHost} = await loadComponent('../../src/system-actions/SaveURLHost.tsx', {
      react: React, 'react-native': {...host.native, Platform: {OS: 'ios'}},
      '../components/SourceUI': ui, '../theme': {mobileColors: {text: '#111', mutedText: '#555'}, mobileTypography: {body: {}, metadata: {}}},
    });
    const router = {subscribe: () => () => {}, getSnapshot: () => null, receive: async () => {}, discardUnavailable: async () => {}};
    function Gate() {
      const [ready, updateReady] = React.useState(false);
      setReady = updateReady;
      return React.createElement(React.Fragment, null,
        React.createElement('button', {'data-testid': 'login-ready', onClick: () => {currentOwner = owner; updateReady(true);}}, 'login'),
        React.createElement(SaveURLHost, {controller, router, owner: ready ? owner : null, ready, appIntents: {isAvailable: () => true, useAppIntents() {}}, t: key => key}));
    }
    const {withRenderedElement} = await import('../reader/parity-host.mjs');
    await withRenderedElement(React.createElement(Gate), async container => {
      await tick();
      assert.equal(container.querySelector('[data-testid="system-save-review"]'), null);
      assert.equal(saved, 0); assert.equal(journal.items[0].status, 'pending');
      await React.act(async () => container.querySelector('[data-testid="login-ready"]').click());
      await tick(); assert.ok(container.querySelector('[data-testid="system-save-review"]'));
      assert.equal(saved, 0);
      await React.act(async () => container.querySelector('[data-testid="system-save-claim"]').click());
      await tick(); await tick();
      assert.equal(saved, 1); assert.equal(journal.items[0].status, 'complete');
    });
    controller.dispose();
  });
});

test('Android widget stale route presents unavailable recovery and can be discarded', async () => {
  await withNativeHost(async host => {
    let discarded = 0;
    const emptyReceipts = [];
    const controller = {subscribe: () => () => {}, getSnapshot: () => emptyReceipts, activate() {}, receive: async () => {}, dispose() {}};
    const issue = {id: 'stale-widget', status: 'unavailable'};
    const router = {subscribe: () => () => {}, getSnapshot: () => issue, receive: async () => {}, discardUnavailable: async id => {assert.equal(id, 'stale-widget'); discarded++;}};
    const ui = {
      SourceText: ({children, testID}) => React.createElement('div', {'data-testid': testID}, children),
      SourceButton: ({label, onPress, testID}) => React.createElement('button', {'data-testid': testID, onClick: onPress}, label),
      SourceDialog: ({visible, children, title, testID}) => visible ? React.createElement('section', {'data-testid': testID}, title, children) : null,
    };
    const {SaveURLHost} = await loadComponent('../../src/system-actions/SaveURLHost.tsx', {
      react: React, 'react-native': {...host.native, Platform: {OS: 'android'}},
      '../components/SourceUI': ui, '../theme': {mobileColors: {text: '#111', mutedText: '#555'}, mobileTypography: {body: {}, metadata: {}}},
    });
    const {withRenderedElement} = await import('../reader/parity-host.mjs');
    await withRenderedElement(React.createElement(SaveURLHost, {controller, router, owner: null, ready: false, t: key => key}), async container => {
      assert.ok(container.querySelector('[data-testid="system-entry-unavailable"]'));
      await React.act(async () => container.querySelector('[data-testid="system-entry-discard"]').click());
      assert.equal(discarded, 1);
    });
  });
});
