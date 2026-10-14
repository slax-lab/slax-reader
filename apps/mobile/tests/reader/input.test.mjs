import test from 'node:test'
import assert from 'node:assert/strict'
import {parseReaderInputSnapshot} from '../../src/reader/input.ts'
import {parseReaderMessage} from '../../src/reader/bridge.ts'

const valid = {sequence: 1, touchStarts: 1, touchEnds: 1, touchCancels: 0, clicks: 0, selectionChanges: 0,
  bubbleTouchStarts: 1, bubbleTouchEnds: 1, bubbleTouchCancels: 0,
  sourceMarkClicks: 1, sourceSelections: 0, sourceDeselections: 0, sourceErrors: 0, lastDomEventCode: 2, lastSourceEventCode: 1,
  lastTouchCount: 1, lastTouchHadStart: true, lastTouchRangePresent: false, lastTouchRangeCollapsed: null, lastTouchMovedX: 0, lastTouchMovedY: 0, lastTargetClosestMark: true,
  lastHitClosestMark: true, lastMarkInfoPresent: true, lastMarkCommentCount: 1, monitorPresent: true, monitoring: true,
  pointerDown: false, pendingSelection: false, selectionTimerActive: false, lastSelectionTextLength: 0,
  rangePresent: false, rangeCollapsed: null, rangeInsideMonitor: false, rangeSuppressed: false}

test('strict input snapshots reject extra data, invalid flags/counts and stale pages', () => {
  assert.deepEqual(parseReaderInputSnapshot(valid), valid)
  for (const value of [{...valid, text: 'untrusted'}, {...valid, markId: 'untrusted'}, {...valid, token: 'untrusted'},
    {...valid, touchStarts: -1}, {...valid, sourceMarkClicks: 1.5}, {...valid, sequence: 1_000_001},
    {...valid, pointerDown: 1}, {...valid, rangeCollapsed: 0}, {...valid, lastTouchMovedX: -0.1},
    {...valid, lastTouchMovedX: Infinity}, {...valid, lastSourceEventCode: 7}, {...valid, lastDomEventCode: 6}, [], null]) {
    assert.equal(parseReaderInputSnapshot(value), null)
  }
  const missing = {...valid}; delete missing.touchEnds
  assert.equal(parseReaderInputSnapshot(missing), null)
  const message = snapshot => JSON.stringify({channel: 'slax-reader', pageId: 'current', payload: {type: 'inputObservation', snapshot}})
  assert.equal(parseReaderMessage(message({...valid, text: 'untrusted'}), 'current'), null)
  assert.equal(parseReaderMessage(message(valid), 'previous'), null)
  assert.deepEqual(parseReaderMessage(message(valid), 'current'), {type: 'inputObservation', snapshot: valid})
})
