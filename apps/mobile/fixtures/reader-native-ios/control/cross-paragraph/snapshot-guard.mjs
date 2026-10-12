// Readonly fixture acceptance guard. Calling this function performs no native
// input, DOM command, source preparation, file write or network operation.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = value => finite(value) && value >= 0 && value <= 100_000;
const fail = message => { throw new Error(`Controlled cross-paragraph observation refused: ${message}`); };
const close = (left, right) => finite(left) && finite(right) && Math.abs(left - right) <= 0.5;

function snapshot(value) {
  if (!value || value.controlledFixture !== true || value.fixtureVersion !== 1 ||
      typeof value.cacheKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.cacheKey)) fail('not a controlled snapshot');
  const {monitor, captured, applicationSelection, position} = value;
  if (!monitor || monitor.iosSourceBridgePresent !== true || monitor.monitorPresent !== true ||
      monitor.monitoring !== true || monitor.pointerDown !== false || monitor.pendingSelection !== false ||
      monitor.selectionTimerActive !== false || monitor.rangePresent !== true || monitor.rangeCollapsed !== false ||
      monitor.rangeInsideMonitor !== true || monitor.rangeSuppressed !== false) fail('the native source range is not settled');
  if (!captured || !applicationSelection || !Number.isSafeInteger(captured.paths) || captured.paths < 1 || captured.paths > 10_000 ||
      !Number.isSafeInteger(captured.textLength) || !Number.isSafeInteger(applicationSelection.textLength) ||
      captured.textLength < 1 || captured.textLength > 100_000 ||
      applicationSelection.textLength < 1 || applicationSelection.textLength > 100_000 ||
      !Number.isSafeInteger(monitor.lastSelectionTextLength) || monitor.lastSelectionTextLength < 1 ||
      monitor.lastSelectionTextLength > 100_000) fail('the application or captured source selection is absent');
  const bounds = monitor.rangeClientBounds;
  if (!bounds || ![bounds.top, bounds.bottom, bounds.left, bounds.right].every(finite) ||
      bounds.bottom <= bounds.top || bounds.right <= bounds.left) fail('invalid actual DOM range bounds');
  if (!position || position.requestedPixels !== 240 || position.consumed !== true ||
      position.bridge?.ready !== true || position.bridge?.documentLoaded !== true ||
      position.bridge?.loadStarts !== 1 || position.bridge?.loadEnds !== 1 || position.bridge?.rejectedMessages !== 0 ||
      typeof position.bridge?.pageId !== 'string' || !position.bridge.pageId ||
      !Number.isSafeInteger(position.bridge?.nativeTag) || position.bridge.nativeTag < 1 ||
      position.geometry?.pixelRatio !== 3 || position.geometry?.containerScreenTopPoints !== 0 ||
      position.geometry?.webViewScreenTopPoints !== 0 || position.geometry?.viewportHeightPoints !== 874 ||
      !close(position.observed?.positionPixels, 240)) fail('the inspected full-window native page/position differs');
  return value;
}

/** The executor must additionally verify the report's immutable raw artifacts. */
export function bindGenuineAlphaContinuation(report, beforeValue, expected) {
  const before = snapshot(beforeValue);
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!expected || expected.device !== 'B85A7582-A0A7-4A0F-9BF0-8424330859F3' ||
      typeof expected.scopeUri !== 'string' ||
      !expected.scopeUri.startsWith(`file:///Users/daguang/Library/Developer/CoreSimulator/Devices/${expected.device}/data/Containers/Data/Application/`) ||
      !/\/Library\/Caches\/slax-ui-fixtures\/reader-mixed-[0-9]+-[a-f0-9]+\/$/.test(expected.scopeUri) ||
      ![expected.inputSha256, expected.stageMarkerSha256, expected.installedExecutableSha256,
        expected.installedDebugDylibSha256, expected.helperMachOSha256, expected.xctestrunSha256].every(hex)) fail('unbound explicit current device/scope/source inputs');
  if (!report || report.platform !== 'ios-simulator' || report.identity !== 'app.slax.reader.uifixture' ||
      report.publisherBuild !== false || report.device !== expected.device || report.scopeUri !== expected.scopeUri ||
      report.completedXcresultInfoPresent !== true || report.nativeTests?.testName !== 'testNativeLongPressOriginalBodyWord' ||
      report.nativeTests?.total !== 1 || report.nativeTests?.passed !== 1 || report.nativeTests?.failed !== 0 || report.nativeTests?.skipped !== 0 ||
      report.wrapper?.exitCode !== 0 || report.wrapper?.refused !== null ||
      report.actualInput?.type !== 'native-XCTest' || report.actualInput?.target !== 'unique-hittable-Alpha-StaticText' ||
      report.actualInput?.pressSeconds !== 1 || report.actualInput?.pressCount !== 1 ||
      report.actualInput?.domRangePrepared !== false || report.actualInput?.syntheticSelectionPublished !== false) fail('no completed genuine single native Alpha press');
  for (const key of ['inputSha256', 'stageMarkerSha256', 'installedExecutableSha256', 'installedDebugDylibSha256', 'helperMachOSha256', 'xctestrunSha256']) {
    if (report[key] !== expected[key]) fail(`current ${key} differs from the native press ancestry`);
  }
  if (before.cacheKey !== expected.cacheKey || before.captured.textLength !== 5 || before.captured.paths !== 1 ||
      before.applicationSelection.textLength !== 5 || before.monitor.lastSelectionTextLength !== 5) fail('the current range is not the genuine five-character Alpha continuation');
  return {type: 'genuine-native-Alpha-report-and-snapshot-bound', device: expected.device,
    scopeUri: expected.scopeUri, pageId: before.position.bridge.pageId,
    rawArtifactVerificationStillRequired: true, currentNativeStateIndependentlyObserved: false};
}

/** Quantitative range crossing only. Exact copied/highlighted text needs its own evidence. */
export function observeCrossParagraphRange(beforeValue, afterValue, actualNativeGeometry) {
  const before = snapshot(beforeValue), after = snapshot(afterValue);
  const geometry = actualNativeGeometry;
  if (!geometry || !geometry.alpha || !geometry.second || !geometry.endHandle || !geometry.dragDestination ||
      geometry.domRangePrepared !== false || geometry.syntheticSelectionPublished !== false) fail('no native-only geometry receipt');
  for (const rect of [geometry.alpha, geometry.second]) {
    if (![rect.x, rect.y, rect.width, rect.height].every(bounded) || rect.width <= 0 || rect.height <= 0) fail('invalid native text frame');
  }
  if (!close(geometry.alpha.x, 20) || !close(geometry.alpha.width, 46) || !close(geometry.alpha.height, 20) ||
      !close(geometry.second.x, 75) || !close(geometry.second.width, 164) || !close(geometry.second.height, 20) ||
      !close(geometry.second.y - geometry.alpha.y, 52)) fail('not the inspected adjacent native paragraphs');
  if (![geometry.endHandle.x, geometry.endHandle.y, geometry.dragDestination.x, geometry.dragDestination.y].every(bounded) ||
      geometry.endHandle.x <= geometry.alpha.x + geometry.alpha.width / 2 ||
      geometry.endHandle.x > geometry.alpha.x + geometry.alpha.width + 2 ||
      geometry.endHandle.y <= geometry.alpha.y + geometry.alpha.height ||
      geometry.dragDestination.x < geometry.second.x || geometry.dragDestination.x >= geometry.second.x + geometry.second.width ||
      geometry.dragDestination.y < geometry.second.y || geometry.dragDestination.y >= geometry.second.y + geometry.second.height) fail('actual handle/destination frame mismatch');
  if (before.cacheKey !== after.cacheKey || before.position.bridge.pageId !== after.position.bridge.pageId ||
      before.position.bridge.nativeTag !== after.position.bridge.nativeTag) fail('a different page cannot supply the after snapshot');
  if (before.captured.paths !== 1 || before.captured.textLength !== 5) fail('the starting range is not native Alpha');
  if (after.captured.paths <= before.captured.paths || after.captured.textLength <= before.captured.textLength ||
      after.applicationSelection.textLength <= before.applicationSelection.textLength ||
      after.monitor.lastSelectionTextLength <= before.monitor.lastSelectionTextLength) fail('the source or application range did not extend');
  const offset = geometry.alpha.y - before.monitor.rangeClientBounds.top;
  if (!close(after.monitor.rangeClientBounds.top, before.monitor.rangeClientBounds.top) ||
      !close(after.monitor.rangeClientBounds.left, before.monitor.rangeClientBounds.left) ||
      after.monitor.rangeClientBounds.bottom + offset <= geometry.second.y) fail('the observed range did not reach the second paragraph');
  return {
    // Source capture joins select_content text, whereas SelectionMonitor stores
    // window.Selection.toString(), which may include paragraph separators. Do
    // not silently require their lengths to be identical across paragraphs.
    type: 'readonly-cross-paragraph-range-observed', sourceSelectedCharacters: after.captured.textLength,
    applicationSelectedCharacters: after.applicationSelection.textLength,
    sourcePaths: after.captured.paths, pageId: after.position.bridge.pageId,
    nativePositionPixels: after.position.observed.positionPixels,
    secondParagraphReached: true, exactCopiedOrHighlightedTextVerified: false,
  };
}
