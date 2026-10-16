#!/usr/bin/env python3
"""Turn fresh readonly original WK measurements into one bounded native gesture request."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
from uuid import UUID

FIXTURE_SHA = 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f'
SOURCE_SHA = '3501089ae75682a823afdfb54ccf243d32cbc56eba1f84bd70c68afafc1f2943'


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def number(value):
    require(type(value) in (float, int) and math.isfinite(value), 'Expected finite native measurement')
    return value


def checked_request(observation, gesture_index, now=None):
    now = time.time() if now is None else now
    require(type(gesture_index) is int and 1 <= gesture_index <= 3, 'At most three allocated genuine drags')
    require(observation.get('kind') == 'original-source-native-reader-observation' and
            observation.get('controlledFixture') is True and observation.get('fixtureVersion') == 1 and
            observation.get('bundleIdentifier') == 'app.slax.reader.sourcefixture', 'Wrong native producer')
    require(observation.get('state') == 'observing', 'Readonly native observer is not live')
    nonce = str(UUID(observation['observationNonce']))
    UUID(observation['webIdentity'])
    require(observation.get('scale') == 3 and observation.get('appearance') == 'light' and
            observation.get('preferredContentSizeCategory') == 'UICTContentSizeCategoryL' and
            observation.get('safeTopPoints') == 62 and observation.get('safeBottomPoints') == 34,
            'The exact matched source conditions differ')
    status = observation.get('sourcePreparedStatus', {})
    require(all(status.get(k) == v for k, v in {
        'controlledFixture': True, 'fixtureVersion': 1, 'state': 'prepared', 'scenario': 'reader-mixed',
        'route': 'Reader', 'locale': 'en', 'selectedActionIndex': -1,
        'fixtureInputSha256': FIXTURE_SHA, 'sourceManifestSha256': SOURCE_SHA}.items()),
        'Current native source route or actual runtime fixture is different')
    samples = observation.get('samples', [])
    require(3 <= len(samples) <= 300, 'Require three actual stable samples inside the finite observer')
    recent = samples[-3:]
    geometry = recent[-1]['geometry']
    require(geometry.get('frameInWindow') == {'x': 0, 'y': 0, 'width': 402, 'height': 874}, 'WK is not full-window')
    keys = ('offsetYPoints', 'topInsetPoints', 'contentWidthPoints', 'contentHeightPoints',
            'viewportWidthPoints', 'viewportHeightPoints', 'positionPixels')
    for sample in recent:
        require(sample.get('bodyAndBridgeReady') is True, 'Actual original body/mark bridge is not ready')
        g = sample['geometry']
        require(all(g.get(k) is v for k, v in {'windowAttached': True, 'loading': False,
                'dragging': False, 'decelerating': False}.items()), 'Native WK is not settled')
        require(all(number(g[k]) == number(geometry[k]) for k in keys), 'Native geometry still changes')
        require(g.get('frameInWindow') == geometry['frameInWindow'], 'Native WK frame changed')
    require(geometry['contentWidthPoints'] == geometry['viewportWidthPoints'] == 402 and
            geometry['viewportHeightPoints'] == 874 and number(geometry['contentHeightPoints']) > 0,
            'Native document viewport has not committed')
    observed_at = number(recent[-1]['observedAtUnixSeconds'])
    require(0 <= now - observed_at <= 2, 'Before-input native snapshot is stale')
    require(all(number(recent[i]['elapsedSeconds']) < number(recent[i + 1]['elapsedSeconds']) for i in range(2)),
            'Native sample order is invalid')
    events = observation.get('nativeKvoEvents', [])
    event_count = observation.get('nativeKvoEventCount')
    require(type(event_count) is int and event_count >= len(events) and len(events) <= 128,
            'Native callback counter or finite event buffer is invalid')
    require(all(e.get('kind') in ('native-contentOffset-KVO', 'native-contentSize-KVO', 'native-bounds-KVO') and
                type(e.get('sequence')) is int and 1 <= e['sequence'] <= event_count for e in events),
            'Unknown native observation event')
    actual = max(0, geometry['offsetYPoints'] + geometry['topInsetPoints']) * 3
    require(geometry['positionPixels'] == actual, 'Observed pixel value disagrees with actual native offset/inset')
    residual = (240 - actual) / 3
    require(residual != 0, 'Already measured240; capture it without fabricating a gesture')
    delta = max(-120, min(120, residual))
    start, end = {'x': 360, 'y': 600}, {'x': 360, 'y': 600 - delta}
    body_start = max(0, -geometry['offsetYPoints'])
    require(all(body_start + 40 <= p['y'] <= 874 - 120 for p in (start, end)), 'Body endpoints obstructed')
    return {'kind': 'original-source-native-scroll-request', 'fixtureVersion': 1,
            'observationNonce': observation['observationNonce'], 'canonicalNonce': nonce,
            'webIdentity': observation['webIdentity'], 'fixtureInputSha256': FIXTURE_SHA,
            'sourceManifestSha256': SOURCE_SHA, 'gestureIndex': gesture_index,
            'observedAtUnixSeconds': observed_at, 'bodyAndBridgeReady': True, 'beforeGeometry': geometry,
            'beforeNativeKvoEventCount': event_count,
            'startPoints': start, 'endPoints': end, 'requestedTargetPixels': 240,
            'nativeInteractionVerified': False, 'positionAccepted': False,
            'verification': 'Only post-input real native KVO and settled same-identity samples may establish resulting pixels'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--observation', required=True)
    parser.add_argument('--gesture-index', type=int, required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = Path(args.observation).absolute()
    require(source.name == 'fixture-native-reader-observation.json' and source.is_file() and
            not source.is_symlink() and all(not p.is_symlink() for p in source.parents), 'Wrong regular observation file')
    raw = source.read_bytes()
    require(len(raw) <= 1024 * 1024, 'Observation exceeds its native bounded shape')
    request = checked_request(json.loads(raw), args.gesture_index)
    request['actualObservationSha256'] = hashlib.sha256(raw).hexdigest()
    data = (json.dumps(request, indent=2) + '\n').encode()
    require(len(data) <= 16 * 1024, 'Native request exceeds the test boundary')
    output = Path(args.output).absolute()
    require(not output.exists() and not output.is_symlink() and output.parent.is_dir() and
            all(not p.is_symlink() for p in output.parents), 'Require new output in an existing allocated directory')
    with output.open('xb') as f:
        f.write(data)
    print(json.dumps({'requestPath': str(output), 'sha256': hashlib.sha256(data).hexdigest(),
                      'nativeInteractionVerified': False, 'positionAccepted': False}))


if __name__ == '__main__':
    main()
