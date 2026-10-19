import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {bindGenuineAlphaContinuation, observeCrossParagraphRange} from './snapshot-guard.mjs';

const original = JSON.parse(await readFile(new URL('../../../../../../retired-evidence', import.meta.url), 'utf8'));
const genuineReport = JSON.parse(await readFile(new URL('../../../../../../retired-evidence', import.meta.url), 'utf8'));
const expected = Object.fromEntries(['device', 'scopeUri', 'inputSha256', 'stageMarkerSha256', 'installedExecutableSha256',
  'installedDebugDylibSha256', 'helperMachOSha256', 'xctestrunSha256'].map(key => [key, genuineReport[key]]));
expected.cacheKey = original.cacheKey;
const actualFrames = {
  alpha: {x: 20, y: 326, width: 46, height: 20}, second: {x: 75, y: 378, width: 164, height: 20},
  endHandle: {x: 62, y: 353.1666666667}, dragDestination: {x: 238, y: 388},
  domRangePrepared: false, syntheticSelectionPublished: false,
};
// Guard test data only: this constructed range is never injected into a WebView
// or published as native acceptance. Native cross-paragraph execution is pending.
function extended() {
  const value = structuredClone(original);
  value.captured = {textLength: 43, paths: 5};
  value.applicationSelection.textLength = 45;
  value.monitor.lastSelectionTextLength = 45;
  value.monitor.rangeClientBounds = {top: 4, bottom: 76, left: 20, right: 239};
  return value;
}

test('the actual completed Alpha ancestry can be bound but does not certify current live state', () => {
  const result = bindGenuineAlphaContinuation(genuineReport, original, expected);
  assert.equal(result.rawArtifactVerificationStillRequired, true);
  assert.equal(result.currentNativeStateIndependentlyObserved, false);
});
test('new scope/source, incomplete results and synthetic or repeated input cannot reuse old Alpha proof', () => {
  assert.throws(() => bindGenuineAlphaContinuation(genuineReport, original, {...expected, scopeUri: expected.scopeUri.replace(/-[a-f0-9]+\/$/, '-ffff/')}), /genuine/);
  assert.throws(() => bindGenuineAlphaContinuation(genuineReport, original, {...expected, stageMarkerSha256: 'f'.repeat(64)}), /ancestry/);
  for (const change of [
    report => {report.completedXcresultInfoPresent = false;},
    report => {report.actualInput.domRangePrepared = true;},
    report => {report.actualInput.pressCount = 2;},
    report => {report.nativeTests.failed = 1;},
  ]) {
    const report = structuredClone(genuineReport); change(report);
    assert.throws(() => bindGenuineAlphaContinuation(report, original, expected));
  }
});

test('the actual native Alpha observation is insufficient for cross-paragraph acceptance', () => {
  assert.throws(() => observeCrossParagraphRange(original, original, actualFrames), /did not extend/);
});
test('the guard admits a same-page extended range crossing the actual second native text frame', () => {
  const result = observeCrossParagraphRange(original, extended(), actualFrames);
  assert.equal(result.secondParagraphReached, true);
  assert.equal(result.sourceSelectedCharacters, 43);
  assert.equal(result.applicationSelectedCharacters, 45);
  assert.equal(result.exactCopiedOrHighlightedTextVerified, false);
});
test('multiple paths within the first paragraph are insufficient', () => {
  const value = extended(); value.monitor.rangeClientBounds.bottom = 24;
  assert.throws(() => observeCrossParagraphRange(original, value, actualFrames), /did not reach/);
});
test('synthetic preparation, stale page and unreturned application selection fail closed', () => {
  assert.throws(() => observeCrossParagraphRange(original, extended(), {...actualFrames, domRangePrepared: true}), /native-only/);
  const stale = extended(); stale.position.bridge.pageId = 'reader-2';
  assert.throws(() => observeCrossParagraphRange(original, stale, actualFrames), /different page/);
  const missing = extended(); missing.applicationSelection = null;
  assert.throws(() => observeCrossParagraphRange(original, missing, actualFrames), /absent/);
  const staleMenu = extended(); staleMenu.applicationSelection.textLength = 5;
  assert.throws(() => observeCrossParagraphRange(original, staleMenu, actualFrames), /did not extend/);
});
test('unsupported viewport, native scroll loss and a collapsed or unsettled range fail closed', () => {
  for (const change of [
    value => {value.position.geometry.viewportHeightPoints = 758;},
    value => {value.position.observed.positionPixels = 0;},
    value => {value.monitor.rangeCollapsed = true;},
    value => {value.monitor.pointerDown = true;},
    value => {value.monitor.pendingSelection = true;},
    value => {value.monitor.rangeClientBounds.bottom = Infinity;},
  ]) {
    const value = extended(); change(value);
    assert.throws(() => observeCrossParagraphRange(original, value, actualFrames));
  }
});
