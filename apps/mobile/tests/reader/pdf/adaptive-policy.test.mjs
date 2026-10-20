import test from 'node:test';
import assert from 'node:assert/strict';
import {accessibilityPageOrder, choosePdfLayout, mapPdfAnnotation, normalizePdfProgress, pagesForSpread, restorePdfProgress} from '../../../src/reader/pdf/adaptive/policy.ts';

test('measured usable width, opt-in and platform gate choose spread without hinge angle', () => {
  assert.deepEqual(choosePdfLayout({enabled: true, supported: true, windowWidth: 1000, safeArea: {left: 20, right: 20}, minPaneWidth: 400, gutter: 24}), {mode: 'spread', usableWidth: 960, paneWidth: 468});
  assert.equal(choosePdfLayout({enabled: true, supported: true, windowWidth: 800, safeArea: {left: 20, right: 20}, minPaneWidth: 400, gutter: 24}).mode, 'single');
  assert.equal(choosePdfLayout({enabled: false, supported: true, windowWidth: 1200, safeArea: {left: 0, right: 0}, minPaneWidth: 400, gutter: 24}).mode, 'single');
  assert.equal(choosePdfLayout({enabled: true, supported: false, windowWidth: 1200, safeArea: {left: 0, right: 0}, minPaneWidth: 400, gutter: 24}).mode, 'single');
});

test('restored page stays in its adjacent spread and odd final page has no invented partner', () => {
  assert.deepEqual(pagesForSpread(2, 7), {firstPage: 1, secondPage: 2, anchorPage: 2});
  const last = pagesForSpread(7, 7);
  assert.deepEqual(last, {firstPage: 7, secondPage: null, anchorPage: 7});
  assert.deepEqual(accessibilityPageOrder(last), [7]);
  const progress = normalizePdfProgress(2, 315, 900);
  assert.deepEqual(restorePdfProgress(progress, 1200, 7), {page: 2, positionInPage: 420});
  assert.deepEqual(restorePdfProgress(progress, 400, 7), {page: 2, positionInPage: 140});
});

test('annotation geometry remains attached to document page while pane bounds change', () => {
  const normalized = {x: 0.25, y: 0.1, width: 0.5, height: 0.2};
  const rounded = value => Object.fromEntries(Object.entries(value).map(([key, part]) => [key, typeof part === 'number' ? Math.round(part * 1000) / 1000 : part]));
  assert.deepEqual(rounded(mapPdfAnnotation(4, normalized, {left: 0, top: 10, width: 400, height: 800})), {page: 4, left: 100, top: 90, width: 200, height: 160});
  assert.deepEqual(rounded(mapPdfAnnotation(4, normalized, {left: 420, top: 10, width: 300, height: 600})), {page: 4, left: 495, top: 70, width: 150, height: 120});
  assert.equal(mapPdfAnnotation(0, normalized, {left: 0, top: 0, width: 0, height: 10}), null);
});
