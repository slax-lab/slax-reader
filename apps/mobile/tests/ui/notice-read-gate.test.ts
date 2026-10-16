import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {NoticeReadGate, noticeGeometryScript} from '../../src/screens/notice-read-gate.ts';

const notice = 'https://reader.test/delete-account-notice';
const geometry = (generation: number, extra = {}) => ({kind: 'delete-notice-geometry', generation, documentUrl: notice, ready: true, hasContent: true, height: 1200, visible: 600, y: 0, ...extra});
test('blank, provisional and failed pages cannot enable deletion through native scroll', () => {
  const gate = new NoticeReadGate(notice, false);
  gate.beginLoad(); assert.equal(gate.nativeGeometry(600, 600, 0), false);
  const generation = gate.loadSucceeded(notice)!;
  assert.equal(gate.documentGeometry(notice, geometry(generation, {hasContent: false, height: 600})), false);
  assert.equal(gate.nativeGeometry(600, 600, 0), false);
  assert.equal(gate.documentGeometry(notice, geometry(generation, {ready: false, height: 600})), false);
  gate.fail(); assert.equal(gate.documentGeometry(notice, geometry(generation, {height: 600})), false);
  assert.equal(gate.nativeGeometry(600, 600, 0), false);
});
test('verified long notices require their bottom; short valid notices count as read', () => {
  const gate = new NoticeReadGate(notice, false); gate.beginLoad();
  const generation = gate.loadSucceeded(notice)!;
  assert.equal(gate.documentGeometry(notice, geometry(generation)), false);
  assert.equal(gate.nativeGeometry(1200, 600, 200), false);
  assert.equal(gate.nativeGeometry(1200, 600, 600), true);
  gate.beginLoad(); assert.equal(gate.canDelete, false);
  const next = gate.loadSucceeded(notice)!;
  assert.equal(gate.documentGeometry(notice, geometry(generation, {height: 600})), false);
  assert.equal(gate.documentGeometry(notice, geometry(next, {height: 500})), true);
  gate.fail(); assert.equal(gate.canDelete, false);
});
test('only the expected notice URL or isolated local document can verify geometry', () => {
  const gate = new NoticeReadGate(notice, false); gate.beginLoad();
  assert.equal(gate.loadSucceeded('https://reader.test/login'), null);
  assert.equal(gate.loadSucceeded('https://other.test/delete-account-notice'), null);
  const generation = gate.loadSucceeded(notice)!;
  assert.equal(gate.documentGeometry(notice, geometry(generation, {height: Number.NaN})), false);
  assert.equal(gate.documentGeometry('about:blank', geometry(generation, {height: 500})), false);
  const local = new NoticeReadGate(notice, true); local.beginLoad();
  assert.equal(local.loadSucceeded(notice), null);
  const localGeneration = local.loadSucceeded('about:blank')!;
  assert.equal(local.documentGeometry('about:blank', geometry(localGeneration, {documentUrl: 'about:blank', height: 500})), true);
});
test('actual injected geometry carries the document URL across Android origin-only messages', () => {
  const gate = new NoticeReadGate(notice, false); gate.beginLoad();
  const generation = gate.loadSucceeded(notice)!;
  let report: ReturnType<typeof geometry> | null = null;
  const window = {location: {href: notice}, innerHeight: 600, scrollY: 600, addEventListener() {}, ReactNativeWebView: {postMessage(value: string) {report = JSON.parse(value);}}};
  runInNewContext(noticeGeometryScript(generation), {window, document: {readyState: 'complete', documentElement: {scrollHeight: 1200}, body: {scrollHeight: 1200, innerText: 'Read the notice'}}, requestAnimationFrame(callback: () => void) {callback();}});
  assert.ok(report);
  assert.equal(gate.documentGeometry('https://reader.test', report), true);
});
test('origin-only and opaque fixture messages cannot bypass loaded URL, document or generation checks', () => {
  const gate = new NoticeReadGate(notice, false); gate.beginLoad();
  const beforeLoad = geometry(1, {height: 500});
  assert.equal(gate.documentGeometry('https://reader.test', beforeLoad), false);
  const generation = gate.loadSucceeded(notice)!;
  assert.equal(gate.documentGeometry('https://other.test', geometry(generation, {height: 500})), false);
  assert.equal(gate.documentGeometry('https://reader.test', geometry(generation, {documentUrl: 'https://reader.test/login', height: 500})), false);
  assert.equal(gate.documentGeometry('null', geometry(generation, {height: 500})), false);
  assert.equal(gate.documentGeometry('https://reader.test', geometry(generation, {documentUrl: undefined, height: 500})), false);
  const local = new NoticeReadGate(notice, true); local.beginLoad();
  const localGeneration = local.loadSucceeded('about:blank')!;
  assert.equal(local.documentGeometry('https://reader.test', geometry(localGeneration, {documentUrl: 'about:blank', height: 500})), false);
  assert.equal(local.documentGeometry('null', geometry(localGeneration, {documentUrl: 'about:blank', height: 500})), true);
  local.beginLoad();
  assert.equal(local.documentGeometry('null', geometry(localGeneration, {documentUrl: 'about:blank', height: 500})), false);
});
