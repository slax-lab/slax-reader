#!/usr/bin/env python3
"""Focused host-only warm-cache and exact refusal diagnostics; no native tools."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('warm_shell_r2', Path(__file__).with_name('build.py'))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)


class WarmCacheGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='slax-fresh-warm-host-')
        self.root = Path(self.temp.name).resolve()
        self.native = patch.object(b.subprocess, 'Popen', side_effect=AssertionError('No native or other commands in focused tests'))
        self.native.start()
        self.free = SimpleNamespace(f_bavail=10 * b.BUDGET['floorBytes'], f_frsize=1)
        self.disk = patch.object(b.os, 'statvfs', return_value=self.free); self.disk.start()
        self.began = time.monotonic(); self.expires = int(time.time() * 1000) + 600000

    def tearDown(self):
        self.disk.stop(); self.native.stop(); self.temp.cleanup()

    def fixture(self):
        source = self.root / 'synthetic-old-cache'; source.mkdir()
        sub = source / 'public-key'; sub.mkdir()
        for i in range(101):
            p = sub / f'module-{i:03d}.pcm'; p.write_bytes(f'public-synthetic-pcm-{i}'.encode()); p.chmod(0o640)
        t = b.tree(source)
        manifest = {'warmCache': {'path': str(source), 'rootMode': stat.S_IMODE(source.lstat().st_mode),
            'regularFiles': 101, 'nestedDirectories': 1, 'logicalBytes': sum(i['bytes'] for i in t['files']),
            'tree': t, 'treeSHA256': hashlib.sha256(json.dumps(t, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}}
        output = self.root / 'own-output'; output.mkdir()
        return manifest, source, output, output / 'swift-module-cache'

    def guard(self, output, observation=None):
        return lambda: b.resource_status(output, self.began, self.expires, observation=observation)

    def test_exact101_copy_matches_hashes_modes_and_original_cache(self):
        m, source, output, dest = self.fixture(); before = b.tree(source)
        result = b.copy_warm_cache(m, dest, self.guard(output))
        self.assertEqual(result, m['warmCache']['treeSHA256'])
        self.assertEqual(b.tree(dest), before); self.assertEqual(b.tree(source), before)
        observed = {}; self.assertIsNone(b.resource_status(output, self.began, self.expires, observation=observed))
        self.assertGreaterEqual(observed['lastActualLogicalBytes'], m['warmCache']['logicalBytes'])
        self.assertGreater(observed['lastActualAllocatedBytes'], 0)

    def test_extra_or_changed_source_refuses_before_copy(self):
        m, source, output, dest = self.fixture()
        (source / 'extra.pcm').write_bytes(b'not-bound')
        with self.assertRaisesRegex(ValueError, 'warm cache changed'):
            b.copy_warm_cache(m, dest, self.guard(output))
        self.assertFalse(dest.exists())

    def test_changed_original_after_copy_still_refuses(self):
        m, source, output, dest = self.fixture(); mutated = False
        def guard():
            nonlocal mutated
            if dest.exists() and len(list(dest.rglob('*.pcm'))) == 101 and not mutated:
                (source / 'public-key/module-000.pcm').write_bytes(b'late-changed-original'); mutated = True
            return b.resource_status(output, self.began, self.expires)
        with self.assertRaisesRegex(ValueError, 'warm cache changed'):
            b.copy_warm_cache(m, dest, guard)
        self.assertTrue(mutated)

    def test_warm_copy_cannot_reuse_existing_destination(self):
        m, _, output, dest = self.fixture(); dest.mkdir()
        with self.assertRaisesRegex(ValueError, 'Fresh warm-cache'):
            b.copy_warm_cache(m, dest, self.guard(output))

    def test_warm_bytes_count_toward_unchanged_artifact_cap(self):
        m, _, output, dest = self.fixture()
        with patch.dict(b.BUDGET, capBytes=b.REPORT_RESERVE + output.lstat().st_blocks * 512 + 4 * 4096):
            with self.assertRaisesRegex(ValueError, 'resource guard|Resource/deadline'):
                b.copy_warm_cache(m, dest, self.guard(output))
        self.assertLess(len(list(dest.rglob('*.pcm'))), 101)
        self.assertEqual(b.BUDGET['capBytes'], 268435456)

    def test_symlink_refusal_records_exact_lstat_and_readlink_without_target_read(self):
        output = self.root / 'own-output'; output.mkdir()
        target = self.root / 'unread-target'; target.write_bytes(b'must-not-read')
        link = output / 'temporary-lock'; link.symlink_to(target)
        observation = {}
        with patch.object(Path, 'open', side_effect=AssertionError('Refusal must not read target')):
            self.assertEqual(b.resource_status(output, self.began, self.expires, observation=observation), 'unexpected-owned-entry')
        record = observation['firstUnexpectedOwnedEntry']
        self.assertEqual(record['relativePath'], 'temporary-lock'); self.assertEqual(record['readlink'], str(target))
        self.assertTrue(record['symlink']); self.assertFalse(record['targetFollowed'])
        self.assertEqual(record['typeBits'], stat.S_IFLNK); self.assertEqual(record['bytes'], link.lstat().st_size)

    def test_nonlink_special_entry_refuses_with_its_type_no_pcm_inference(self):
        output = self.root / 'own-output'; output.mkdir(); os.mkfifo(output / 'public-generated-pipe')
        observation = {}
        self.assertEqual(b.resource_status(output, self.began, self.expires, observation=observation), 'unexpected-owned-entry')
        record = observation['firstUnexpectedOwnedEntry']
        self.assertEqual(record['typeBits'], stat.S_IFIFO); self.assertFalse(record['symlink'])
        self.assertNotIn('readlink', record)

    def test_readlink_race_preserves_primary_refusal_and_lstat_record(self):
        output = self.root / 'own-output'; output.mkdir(); (output / 'gone-lock').symlink_to('public-target')
        observation = {}
        with patch.object(b.os, 'readlink', side_effect=FileNotFoundError('native rename race')):
            self.assertEqual(b.resource_status(output, self.began, self.expires, observation=observation), 'unexpected-owned-entry')
        self.assertEqual(observation['firstUnexpectedOwnedEntry']['readlinkErrorType'], 'FileNotFoundError')
        self.assertEqual(observation['firstUnexpectedOwnedEntry']['relativePath'], 'gone-lock')
        self.assertFalse(observation['firstUnexpectedOwnedEntry']['targetFollowed'])

    def test_compile_refusal_preserves_primary_and_rechecks_original_cache(self):
        m, source, _, _ = self.fixture()
        old = self.root / 'synthetic-old.app'; old.mkdir()
        (old / 'Info.plist').write_bytes(b'unchanged-info')
        (old / 'SlaxSourceFixtureApp').write_bytes(b'old-executable')
        sources = []
        for name in ('main.swift', 'FixtureReaderStep.swift'):
            item = self.root / name; item.write_bytes(name.encode())
            sources.append({'path': str(item), 'bytes': item.stat().st_size, 'sha256': b.sha(item), 'destination': name})
        output = self.root / 'new-run'
        m.update(oldApplication={'path': str(old), 'tree': b.tree(old)}, shellSources=sources,
                 developerDirectory='/public-unused', sdkPath='/public-unused-sdk', rawFrameworkParent='/public-unused-J',
                 tools=[{'id': 'swiftc', 'invocationPath': '/never-native-swift'},
                        {'id': 'codesign', 'invocationPath': '/never-native-sign'}])
        grant = {'outputRoot': str(output), 'expiresAt': self.expires}
        before = b.tree(source)
        with patch.object(b, 'checked_inputs', return_value=m), patch.object(b, 'allocation', return_value=grant), \
             patch.object(b, 'bounded_command', return_value=(-9, b'actual-host-shim-buffer', b'', 'unexpected-owned-entry')):
            with self.assertRaisesRegex(ValueError, 'Command failed/stopped'):
                b.execute(self.root / 'unused-grant', '0' * 64)
        result = json.loads((output / 'failure.json').read_bytes())
        self.assertEqual(result['commands'][0]['exitCode'], -9)
        self.assertEqual(result['commands'][0]['stopped'], 'unexpected-owned-entry')
        self.assertTrue(result['oldWarmCacheUnchanged']); self.assertEqual(b.tree(source), before)
        self.assertEqual((output / 'compile-fresh-shell.stdout').read_bytes(), b'actual-host-shim-buffer')
        self.assertEqual(len(result['commands']), 1); self.assertFalse(result['native240Accepted'])

    def test_first_unexpected_record_remains_fixed_for_later_refusals(self):
        output = self.root / 'own-output'; output.mkdir(); first = output / 'first-lock'; first.symlink_to('first-public-target')
        observation = {}; b.resource_status(output, self.began, self.expires, observation=observation)
        original = dict(observation['firstUnexpectedOwnedEntry']); first.unlink()
        (output / 'next-lock').symlink_to('next-public-target')
        self.assertEqual(b.resource_status(output, self.began, self.expires, observation=observation), 'unexpected-owned-entry')
        self.assertEqual(observation['firstUnexpectedOwnedEntry'], original)


if __name__ == '__main__':
    unittest.main()
