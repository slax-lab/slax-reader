import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ReaderNativeAttachment} from '../../src/reader/native-attachment.ts';
import {ReaderBridgeSession} from '../../src/reader/bridge.ts';
import {ReaderPositionWriter} from '../../src/reader/position.ts';
import {rewriteReaderImageTransports} from '../../src/reader/image-transports.ts';

const context = {cacheKey: 'article', pageId: 'page', suppressSelectionMenu: true, scrollsToTop: true};
test('an attach finishing after committed release cannot retain touch listeners or native ownership', async () => {
  const events = []; let release;
  const pending = new Promise(resolve => {release = resolve;});
  const attachment = new ReaderNativeAttachment({attach: async tag => {events.push(['attach', tag]); await pending;}, detach: async tag => {events.push(['detach', tag]);}, subscribeTouch: tag => {events.push(['subscribe', tag]); return () => events.push(['unsubscribe', tag]);}}, () => {}, tag => events.push(['tag', tag]));
  const work = attachment.attach(1, context); await Promise.resolve();
  await attachment.dispose(); release(); await work;
  assert.equal(events.filter(event => event[0] === 'subscribe').length, 0);
  assert.deepEqual(events.at(-1), ['detach', 1]);
  await attachment.attach(2, context); assert.equal(events.filter(event => event[0] === 'attach').length, 1);
});
test('replacement load supersedes a pending older attach and releases subscriptions once', async () => {
  const events = []; let release;
  const pending = new Promise(resolve => {release = resolve;});
  const attachment = new ReaderNativeAttachment({attach: async tag => {events.push(['attach', tag]); if (tag === 1) await pending;}, detach: async tag => {events.push(['detach', tag]);}, subscribeTouch: tag => {events.push(['subscribe', tag]); return () => events.push(['unsubscribe', tag]);}}, () => {}, () => {});
  const first = attachment.attach(1, context); await Promise.resolve();
  await attachment.attach(2, context); release(); await first; await attachment.dispose(); await attachment.dispose();
  assert.deepEqual(events.filter(event => event[0] === 'subscribe'), [['subscribe', 2]]);
  assert.deepEqual(events.filter(event => event[0] === 'unsubscribe'), [['unsubscribe', 2]]);
});
test('an uncommitted back attempt retains live bridge, selection response and newest pending position until actual release', async () => {
  let command; const positions = [];
  const bridge = new ReaderBridgeSession('page', async script => vm.runInNewContext(script, {window: {__SlaxReaderHost: {execute: value => {
    command = value;
    return JSON.stringify({pageId: value.pageId, requestId: value.requestId, status: 'fulfilled', value: {text: 'retained selection'}});
  }}}}));
  const wrap = payload => JSON.stringify({channel: 'slax-reader', pageId: 'page', payload});
  bridge.receive(wrap({type: 'domReady'}));
  const writer = new ReaderPositionWriter((value, reason) => positions.push([value, reason]), () => {}, 2000);
  writer.update(100);
  // Starting/cancelling a navigation gesture never calls either document disposal method.
  const capture = bridge.request({operation: 'captureSelection'}); writer.update(180);
  bridge.receive(wrap({type: 'commandResult', requestId: command.requestId, value: {text: 'retained selection'}}));
  assert.deepEqual(await capture, {text: 'retained selection'});
  assert.equal(positions.length, 0);
  await writer.dispose('exit'); bridge.dispose();
  assert.deepEqual(positions, [[180, 'exit']]);
  await assert.rejects(bridge.request({operation: 'captureSelection'}), /released/);
});
test('pre-parse image transport rewrite preserves DOM text, raw elements, comments, data URIs, quoting and attributes', () => {
  const html = `<!-- <img src="https://comment.invalid/x"> --><script>const text='<img src="https://script.invalid/x">';</script><textarea><img src="https://text.invalid/x"></textarea><p>&lt;img src="https://escaped.invalid/x"&gt;</p><img alt="a > b src=https://text.invalid" src='HTTPS://image.invalid/a?x=1&amp;y=2' data-src="https://lazy.invalid"><img SRC=http://image.invalid/b><img src="data:image/png;base64,AA">`;
  const rewritten = rewriteReaderImageTransports(html);
  assert.equal(rewritten, html.replace("src='HTTPS://image.invalid", "src='slaxstatics://image.invalid").replace('SRC=http://image.invalid', 'SRC=slaxstatic://image.invalid'));
});
