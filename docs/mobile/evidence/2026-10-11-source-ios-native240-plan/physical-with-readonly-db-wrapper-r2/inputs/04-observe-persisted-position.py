#!/usr/bin/env python3
"""Optional fixed-row readonly supplement. Importing/default execution opens no DB."""
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import stat
import time
from uuid import UUID

DEVICE = 'B85A7582-A0A7-4A0F-9BF0-8424330859F3'
DEVICE_ROOT = Path('/Users/daguang/Library/Developer/CoreSimulator/Devices') / DEVICE
BUNDLE = 'app.slax.reader.sourcefixture'
FIXTURE_SHA = 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f'
SOURCE_SHA = '3501089ae75682a823afdfb54ccf243d32cbc56eba1f84bd70c68afafc1f2943'
ROW_ID = '00000003-0000-4000-8000-000000000001'
RELATIVE_DIRECTORY = Path('Library/Application Support/databases')
NAME = re.compile(r'ui-fixture-([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\.db$')
QUERY = "SELECT id, CASE WHEN length(CAST(data AS BLOB))<=65536 THEN data END AS data, CASE WHEN length(CAST(data AS BLOB))<=65536 THEN json_extract(data, '$.read_position') END AS read_position, CASE WHEN length(CAST(data AS BLOB))<=65536 THEN json_type(data, '$.read_position') END AS value_type FROM ps_data_local__local_bookmark_info WHERE id=? LIMIT 1"
MAX_SNAPSHOTS, MAX_SECONDS, MAX_ROW_BYTES = 8, 12, 65536


def require(value, message):
    if not value:
        raise ValueError(message)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and all(not p.is_symlink() for p in (path, *path.parents)), 'Relative/symlink path refused')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode), 'Wrong filesystem entry type')
    return info


def bounded_json(path, cap):
    info = checked_path(path)
    require(info.st_size <= cap, 'Bounded JSON input exceeded')
    raw = Path(path).read_bytes()
    require(len(raw) == info.st_size, 'Input changed while reading')
    return json.loads(raw), digest(raw)


def file_identity(path):
    info = checked_path(path)
    birth = getattr(info, 'st_birthtime', None)
    require(finite(birth), 'Native file birth timestamp is required')
    return {'name': Path(path).name, 'device': info.st_dev, 'inode': info.st_ino,
            'birthUnixSeconds': birth, 'bytes': info.st_size, 'mtimeNs': info.st_mtime_ns}


def same_file(left, right):
    return all(left[key] == right[key] for key in ('name', 'device', 'inode', 'birthUnixSeconds'))


def other_fields(raw):
    value = json.loads(raw)
    require(type(value) is dict and value.get('id') == ROW_ID, 'Wrong fixed canonical row')
    value.pop('read_position', None)
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    return digest(encoded)


class PersistedPositionObserver:
    """A separately authorized observer; no native operation or lifecycle cleanup."""
    def __init__(self, data_root, nonce, grant_path, physical_grant_path):
        self.data_root = Path(data_root)
        relative = self.data_root.relative_to(DEVICE_ROOT / 'data/Containers/Data/Application')
        require(len(relative.parts) == 1 and str(UUID(relative.name)).upper() == relative.name.upper(), 'Wrong unique source data container')
        checked_path(self.data_root, directory=True)
        metadata, _ = bounded_json_metadata(self.data_root / '.com.apple.mobile_container_manager.metadata.plist')
        require(metadata.get('MCMMetadataIdentifier') == BUNDLE, 'Not the isolated original sourcefixture container')
        grant, self.grant_sha = bounded_json(grant_path, 16384)
        physical, physical_sha = bounded_json(physical_grant_path, 32768)
        require(grant.get('kind') == 'root-authorized-original-source-readonly-persisted-position' and
                grant.get('device') == DEVICE and grant.get('bundleIdentifier') == BUNDLE and
                grant.get('observationNonce') == nonce and grant.get('fixtureInputSha256') == FIXTURE_SHA and
                grant.get('onlyRowId') == ROW_ID and grant.get('mode') == 'ro' and
                grant.get('maxSnapshots') == MAX_SNAPSHOTS and grant.get('maxObservationSeconds') == MAX_SECONDS and
                grant.get('helperSHA256') == digest(Path(__file__).read_bytes()) and
                grant.get('physicalGrantSHA256') == physical_sha and
                finite(grant.get('expiresAtUnixSeconds')) and time.time() < grant['expiresAtUnixSeconds'],
                'Separate fixed-row Root grant missing, expired or mismatched')
        require(physical.get('kind') == 'root-one-source-physical-native-scroll-allocation' and
                physical.get('device') == DEVICE and physical.get('observationNonce') == nonce and
                physical.get('onlyTestIdentifier') == 'SourceFixtureControl/SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag' and
                physical.get('exclusiveDeviceLoan') is True and physical.get('attempts') == 1 and
                finite(physical.get('expiresAtUnixSeconds')) and time.time() < physical['expiresAtUnixSeconds'] and
                grant.get('physicalExecutorSHA256') == physical.get('executorSHA256'), 'Different physical source allocation')
        self.nonce = str(UUID(nonce)); self.expires = grant['expiresAtUnixSeconds']
        self.directory = self.data_root / RELATIVE_DIRECTORY
        self.before_names = None; self.before_launch = None; self.database = None; self.identities = None
        self.launch = None; self.web_identity = None; self.zero = None
        self.attempts = 0; self.spent_seconds = 0.0; self.returned_bytes = 0; self.records = []

    def _live(self):
        require(time.time() < self.expires, 'Database allocation expired')
        require(self.attempts < MAX_SNAPSHOTS and self.spent_seconds < MAX_SECONDS, 'Readonly observation budget consumed')

    def capture_before_launch(self, launch_not_before_unix):
        self._live()
        require(self.before_names is None and finite(launch_not_before_unix) and
                0 <= time.time() - launch_not_before_unix <= 2, 'Require one fresh prelaunch baseline')
        self.before_names = self._names()
        self.before_launch = launch_not_before_unix
        return {'kind': 'source-db-filenames-only-before-launch', 'observationNonce': self.nonce,
                'relativeDirectory': RELATIVE_DIRECTORY.as_posix(), 'candidateFiles': self.before_names,
                'noDatabaseRead': True, 'recordedAtUnixSeconds': time.time()}

    def _names(self):
        if not self.directory.exists():
            require(all(not p.is_symlink() for p in (self.directory, *self.directory.parents)), 'Symlink SDK directory refused')
            return []
        checked_path(self.directory, directory=True)
        names = []
        for path in self.directory.iterdir():
            if NAME.fullmatch(path.name):
                names.append(file_identity(path))
        require(len(names) <= 128, 'Candidate filename baseline exceeded')
        return sorted(names, key=lambda value: value['name'])

    def bind_fresh_launch(self, launch):
        self._live()
        require(self.before_names is not None and self.launch is None and launch.get('observationNonce') == self.nonce and
                launch.get('bundleIdentifier') == BUNDLE and launch.get('fixtureInputSha256') == FIXTURE_SHA and
                launch.get('sourceManifestSha256') == SOURCE_SHA and type(launch.get('pid')) is int and launch['pid'] > 0 and
                finite(launch.get('launchedAtUnixSeconds')) and launch['launchedAtUnixSeconds'] >= self.before_launch,
                'One actual same-nonce original source launch is required')
        old = {entry['name'] for entry in self.before_names}
        candidates = [entry for entry in self._names() if entry['name'] not in old]
        require(len(candidates) == 1, 'Require exactly one newly born UUID source DB, never newest-file selection')
        entry = candidates[0]
        require(entry['birthUnixSeconds'] >= launch['launchedAtUnixSeconds'] and
                all((entry['device'], entry['inode']) != (old_entry['device'], old_entry['inode']) for old_entry in self.before_names),
                'Database predates launch baseline or reuses an old inode')
        self.database = self.directory / entry['name']
        self.identities = [file_identity(Path(str(self.database) + suffix)) for suffix in ('', '-wal', '-shm')]
        self.launch = dict(launch)
        return {'kind': 'fresh-source-db-and-existing-wal-shm-bound', 'observationNonce': self.nonce,
                'databaseFiles': self.identities, 'launch': self.launch, 'noDatabaseRead': True}

    def _observation(self, observation):
        require(len(json.dumps(observation).encode()) <= 1048576, 'Native observer input exceeds bound')
        require(self.launch is not None and observation.get('kind') == 'original-source-native-reader-observation' and
                observation.get('controlledFixture') is True and observation.get('fixtureVersion') == 1 and
                observation.get('bundleIdentifier') == BUNDLE and observation.get('observationNonce') == self.nonce and
                observation.get('state') == 'observing', 'Not the same live native source observer')
        status = observation.get('sourcePreparedStatus', {})
        expected = {'controlledFixture': True, 'fixtureVersion': 1, 'state': 'prepared', 'scenario': 'reader-mixed',
                    'route': 'Reader', 'locale': 'en', 'selectedActionIndex': -1,
                    'fixtureInputSha256': FIXTURE_SHA, 'sourceManifestSha256': SOURCE_SHA}
        require(all(status.get(key) == value for key, value in expected.items()), 'Current source route/input differs')
        web = str(UUID(observation['webIdentity']))
        require(self.web_identity is None or self.web_identity == web, 'Original WK identity changed')
        self.web_identity = web
        samples = observation.get('samples', [])
        require(1 <= len(samples) <= 300, 'No bounded native source sample')
        sample = samples[-1]; geometry = sample.get('geometry', {})
        require(len(json.dumps(sample).encode()) <= 8192, 'Native sample exceeds bound')
        require(sample.get('bodyAndBridgeReady') is True and finite(sample.get('observedAtUnixSeconds')) and
                0 <= time.time() - sample['observedAtUnixSeconds'] <= 2 and
                geometry.get('frameInWindow') == {'x': 0, 'y': 0, 'width': 402, 'height': 874} and
                geometry.get('loading') is False and geometry.get('dragging') is False and geometry.get('decelerating') is False,
                'Native ready/settled observation is absent or stale')
        return sample

    def _read(self, phase, observation):
        self._live(); sample = self._observation(observation)
        require(all(same_file(entry, file_identity(Path(str(self.database) + suffix)))
                    for entry, suffix in zip(self.identities, ('', '-wal', '-shm'))), 'Fresh DB/WAL/SHM identity changed')
        self.attempts += 1; began = time.monotonic()
        remaining = MAX_SECONDS - self.spent_seconds
        try:
            # Existing WAL/SHM are required. Ordinary WAL readers may change SHM
            # read-lock metadata; this is not an immutable/main-file-only snapshot.
            connection = sqlite3.connect(self.database.as_uri() + '?mode=ro', uri=True, timeout=min(.25, remaining))
            try:
                connection.execute('PRAGMA query_only=ON')
                connection.set_progress_handler(lambda: int(time.monotonic() - began >= remaining), 1000)
                row = connection.execute(QUERY, (ROW_ID,)).fetchone()
            finally:
                connection.close()
            require(row is not None and row[0] == ROW_ID and row[3] == 'text' and type(row[1]) is str and type(row[2]) is str,
                    'Expected one bounded fixed local row with JSON text position')
            raw = row[1].encode(); require(len(raw) <= MAX_ROW_BYTES, 'Fixed row exceeds bounded size')
            self.returned_bytes += len(raw); require(self.returned_bytes <= MAX_ROW_BYTES * MAX_SNAPSHOTS, 'Total row data exceeded')
            record = {'phase': phase, 'observationNonce': self.nonce, 'webIdentity': self.web_identity,
                      'launchPid': self.launch['pid'], 'databaseFiles': self.identities, 'rowId': row[0],
                      'readPosition': row[2], 'valueType': row[3], 'rowData': row[1], 'rowDataSHA256': digest(raw),
                      'otherFieldsSHA256': other_fields(row[1]), 'observedAtUnixSeconds': time.time(),
                      'nativeSample': sample, 'rawNativeObservationSHA256': digest(json.dumps(observation, sort_keys=True).encode()),
                      'snapshotAttempt': self.attempts, 'persistedDaoOutcomeNotCapturedKotlinCallback': True}
            require(all(same_file(entry, file_identity(Path(str(self.database) + suffix)))
                        for entry, suffix in zip(self.identities, ('', '-wal', '-shm'))), 'SQLite sidecar identity changed during read')
            self.records.append(record); return record
        finally:
            self.spent_seconds += time.monotonic() - began
            require(self.spent_seconds <= MAX_SECONDS, 'Readonly SQL observation time exceeded')
            require(time.time() < self.expires, 'Database allocation expired during read')

    def observe_zero_before_input(self, observation):
        require(self.zero is None, 'Stored zero baseline already bound')
        record = self._read('before-genuine-input', observation)
        require(record['readPosition'] == '0.0', 'Seed240 or another position cannot satisfy actual stored-zero baseline')
        self.zero = record
        return record

    def observe_after_genuine_input(self, observation, completed_input):
        require(self.zero is not None, 'Actually observed stored0 must precede input')
        require(completed_input.get('observationNonce') == self.nonce and completed_input.get('webIdentity') == self.web_identity and
                completed_input.get('onlyTestIdentifier') == 'SourceFixtureControl/SourceFixtureNativeScrollControl/testPerformOneMeasuredOriginalReaderNativeDrag' and
                completed_input.get('nativeTests') == {'total': 1, 'passed': 1, 'failed': 0, 'skipped': 0} and
                type(completed_input.get('gestureIndex')) is int and 1 <= completed_input['gestureIndex'] <= 3 and
                completed_input.get('programmaticScroll') is False and
                finite(completed_input.get('inputEndedAtUnixSeconds')) and
                self.zero['observedAtUnixSeconds'] <= completed_input['inputEndedAtUnixSeconds'] and
                2 <= time.time() - completed_input['inputEndedAtUnixSeconds'],
                'Require same completed genuine source drag and original debounce, not a prepared position')
        record = self._read('after-genuine-input-and-debounce', observation)
        require(record['readPosition'] == '240.0', 'No actual persisted240 transition')
        require(record['otherFieldsSHA256'] == self.zero['otherFieldsSHA256'], 'Other fixed-row fields changed from the actual stored0 baseline')
        require(observation.get('nativeKvoEventCount', 0) > completed_input.get('beforeNativeKvoEventCount', math.inf),
                'No fresh original native KVO event after input')
        record['persistedTransitionObserved'] = 'stored0.0 -> genuine-native-input -> stored240.0'
        record['directKotlinCallbackCaptured'] = False
        return record


def bounded_json_metadata(path):
    info = checked_path(path); require(info.st_size <= 16384, 'MCM metadata exceeds bound')
    raw = Path(path).read_bytes(); return plistlib.loads(raw), digest(raw)


if __name__ == '__main__':
    print(json.dumps({'kind': 'readonly-source-position-helper-preparation-only', 'device': DEVICE,
                      'bundle': BUNDLE, 'relativeDirectory': RELATIVE_DIRECTORY.as_posix(), 'onlyRowId': ROW_ID,
                      'helperSHA256': digest(Path(__file__).read_bytes()), 'noDatabaseRead': True,
                      'separateRootDatabaseGrantRequired': True, 'maxSnapshots': MAX_SNAPSHOTS,
                      'maxSqliteObservationSeconds': MAX_SECONDS}))
