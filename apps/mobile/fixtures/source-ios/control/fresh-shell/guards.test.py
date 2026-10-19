#!/usr/bin/env python3
"""Host-only guards; native commands are replaced, never executed."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import struct
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fresh_shell_build', Path(__file__).with_name('build.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def macho(sdk=0x1a0500, platform=7, minimum=0x100400, duplicate=False, cpu=0x100000c):
    command = struct.pack('<6I', 0x32, 24, platform, minimum, sdk, 0)
    commands = command * (2 if duplicate else 1)
    return struct.pack('<8I', 0xfeedfacf, cpu, 0, 2, 2 if duplicate else 1, len(commands), 0, 0) + commands


class FreshShellGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='slax-fresh-shell-host-')
        self.root = Path(self.temp.name).resolve()
        self.free = SimpleNamespace(f_bavail=10**10, f_frsize=1)
        self.expires = int(time.time() * 1000) + 60000

    def tearDown(self):
        self.temp.cleanup()

    def test_real_parser_distinguishes_actual_old_sdk_from_current_sdk(self):
        p = self.root / 'shell'
        p.write_bytes(macho(sdk=0x100400))
        self.assertEqual(b.build_version(p), {'platform': 7, 'minimumOS': '16.4.0', 'SDK': '16.4.0'})
        with self.assertRaisesRegex(ValueError, 'before signing'):
            b.require_current_sdk(p)
        p.write_bytes(macho())
        self.assertEqual(b.require_current_sdk(p)['SDK'], '26.5.0')

    def test_platform_deployment_architecture_duplicate_and_truncation_refuse(self):
        p = self.root / 'shell'
        for payload in [macho(platform=2), macho(minimum=0xf0000), macho(cpu=0x1000007),
                        macho(duplicate=True), macho()[:-1]]:
            with self.subTest(length=len(payload)):
                p.write_bytes(payload)
                with self.assertRaises(ValueError):
                    b.require_current_sdk(p)

    def status(self, pending=0, live=False):
        with patch.object(b.os, 'statvfs', return_value=self.free):
            return b.resource_status(self.root, time.monotonic(), self.expires, pending, live)

    def test_whole_logical_sparse_bytes_have_no_exception(self):
        p = self.root / 'swift-module-cache'
        p.mkdir()
        with (p / 'known-sparse.pcm').open('wb') as f:
            f.truncate(b.BUDGET['capBytes'])
        self.assertEqual(self.status(), 'artifact-cap')

    def test_buffers_and_record_reserve_count_before_archive(self):
        self.assertEqual(self.status(pending=b.BUDGET['capBytes'] - b.REPORT_RESERVE + 1), 'artifact-cap')

    def test_floor_deadline_and_special_entry_refuse(self):
        with patch.object(b.os, 'statvfs', return_value=SimpleNamespace(f_bavail=b.BUDGET['floorBytes']-1, f_frsize=1)):
            self.assertEqual(b.resource_status(self.root, time.monotonic(), self.expires), 'disk-floor')
        self.assertEqual(b.resource_status(self.root, time.monotonic()-121, self.expires), 'deadline')
        (self.root / 'alias').symlink_to(self.root)
        self.assertEqual(self.status(), 'unexpected-owned-entry')

    def test_only_live_generated_lstat_rename_can_be_skipped(self):
        cache = self.root / 'swift-module-cache'
        cache.mkdir()
        gone = cache / 'renamed.pcm.tmp'
        original = Path.lstat
        def fake(path, *args, **kwargs):
            if path == gone:
                raise FileNotFoundError('actual atomic rename')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'rglob', return_value=iter([gone])), patch.object(Path, 'lstat', fake):
            self.assertIsNone(self.status(live=True))
        with patch.object(Path, 'rglob', return_value=iter([gone])), patch.object(Path, 'lstat', fake):
            with self.assertRaises(FileNotFoundError):
                self.status(live=False)
        protected = self.root / 'shell.swift'
        def protected_missing(path, *args, **kwargs):
            if path == protected:
                raise FileNotFoundError('protected file disappeared')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'rglob', return_value=iter([protected])), patch.object(Path, 'lstat', protected_missing):
            with self.assertRaises(FileNotFoundError):
                self.status(live=True)

    def test_other_generated_errors_never_become_rename_exceptions(self):
        p = self.root / 'swift-module-cache' / 'denied.pcm'
        original = Path.lstat
        def denied(path, *args, **kwargs):
            if path == p:
                raise PermissionError('not an atomic rename')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'rglob', return_value=iter([p])), patch.object(Path, 'lstat', denied):
            with self.assertRaises(PermissionError):
                self.status(live=True)

    def grant(self):
        docs = self.root / 'retired-evidence'
        docs.mkdir(parents=True)
        plan = docs / 'build-plan.json'
        plan.write_text('{}')
        path = docs / 'root-build-allocation.json'
        m = {'allocationPath': str(path), 'outputRoot': '/private/tmp/slax-source-fresh-shell-build-' + str(uuid4())}
        v = {'kind': 'root-one-fresh-source-swift-shell-build-allocation', 'version': 1,
             'outputRoot': m['outputRoot'], 'manifestSHA256': b.MANIFEST_SHA256,
             'executorSHA256': b.sha(Path(b.__file__).resolve()), 'planSHA256': b.sha(plan),
             'oldSource44ShellSHA256': 'a3fde1b120433684d1faee39e55eddb451c699fa1a3ca3695bbe25b31a29f672',
             'rawJMachOSHA256': '1bc0873e19287f6b8cfc99bb9106d124e67a1343bfc06e227f0bce93ce9da38d',
             'budget': b.BUDGET, 'exclusiveNativeBuildSlot': True, 'allowSwiftShellOnly': True,
             'allowFreshSimulatorAdhocSigningOnly': True, 'allowControlOrKmpBuild': False,
             'allowDeviceOrDatabaseOrMetro': False, 'allowOldArtifactMutationOrCleanup': False,
             'nonce': str(uuid4()), 'requestedAt': int(time.time()*1000)-1000,
             'expiresAt': int(time.time()*1000)+60000}
        return path, plan, m, v

    def check_grant(self, path, plan, manifest, value, free=None):
        path.write_text(json.dumps(value))
        with patch.object(b, 'ROOT', self.root), patch.object(b, 'PLAN', plan), \
             patch.object(b.os, 'statvfs', return_value=free or self.free):
            return b.allocation(path, b.sha(path), manifest)

    def test_exact_fresh_grant_admits_no_command_or_output_creation(self):
        path, plan, m, value = self.grant()
        with patch.object(b.subprocess, 'Popen', side_effect=AssertionError('native command forbidden')):
            self.assertEqual(self.check_grant(path, plan, m, value), value)
        self.assertFalse(Path(value['outputRoot']).exists())

    def test_cap_scope_extra_field_expiry_identity_and_alias_refuse(self):
        path, plan, m, value = self.grant()
        changes = [{'budget': dict(b.BUDGET, capBytes=402653184)}, {'allowDeviceOrDatabaseOrMetro': True},
                   {'allowControlOrKmpBuild': True}, {'allowFreshSimulatorAdhocSigningOnly': 1},
                   {'extra': True}, {'expiresAt': int(time.time()*1000)-1}, {'kind': 'old-grant'},
                   {'outputRoot': value['outputRoot'].replace('/private/tmp/', '/tmp/')}]
        for change in changes:
            with self.subTest(change=change):
                v = dict(value, **change)
                with self.assertRaises(ValueError):
                    self.check_grant(path, plan, m, v)
        with self.assertRaisesRegex(ValueError, 'reserve'):
            self.check_grant(path, plan, m, value, SimpleNamespace(f_bavail=b.BUDGET['preFreeBytes']-1, f_frsize=1))

    def test_secret_path_refused_before_any_read(self):
        with patch.object(Path, 'lstat', side_effect=AssertionError('must reject before read')):
            for p in ['.env', 'GoogleService-Info.plist', 'google-services.json', 'credentials.json']:
                with self.assertRaises(ValueError):
                    b.regular(self.root / p)

    def fixture(self):
        old = self.root / 'old.app'
        old.mkdir()
        info = {'CFBundleIdentifier': 'app.slax.reader.sourcefixture'}
        (old / 'Info.plist').write_bytes(plistlib.dumps(info))
        (old / 'SlaxSourceFixtureApp').write_bytes(macho(sdk=0x100400))
        (old / '_CodeSignature').mkdir()
        (old / '_CodeSignature/CodeResources').write_bytes(b'old-signature')
        (old / 'Frameworks').mkdir()
        (old / 'Frameworks/J').write_bytes(b'unchanged-original-code')
        sources = []
        for name in ['main.swift', 'FixtureReaderStep.swift']:
            p = self.root / name
            p.write_bytes(name.encode())
            sources.append({'path': str(p), 'bytes': p.stat().st_size, 'sha256': b.sha(p), 'destination': name})
        output = self.root / 'new-owned-output'
        manifest = {'outputRoot': str(output), 'oldApplication': {'path': str(old), 'tree': b.tree(old)},
                    'shellSources': sources, 'developerDirectory': '/unused-public-test', 'sdkPath': '/unused-sdk',
                    'rawFrameworkParent': '/unused-J', 'infoSHA256': b.sha(old / 'Info.plist'),
                    'tools': [{'id': 'swiftc', 'invocationPath': '/never-invoke-swift'},
                              {'id': 'codesign', 'invocationPath': '/never-invoke-sign'}],
                    'historical33SectionsRootReview': {'scope': 'historical-only'}}
        grant = {'outputRoot': str(output), 'expiresAt': self.expires}
        return manifest, grant, output

    def orchestration(self, sdk=0x1a0500, corrupt=None, compile_exit=0, final_floor=False):
        manifest, grant, output = self.fixture()
        calls = []
        def fake_command(args, env, owned, seconds, guard):
            calls.append(args)
            if args[0] == '/never-invoke-swift':
                self.assertIn('26.5', args)
                (owned / 'SlaxSourceFixtureApp.app/SlaxSourceFixtureApp').write_bytes(macho(sdk=sdk))
                if corrupt:
                    (owned / 'SlaxSourceFixtureApp.app' / corrupt).write_bytes(b'changed')
                return compile_exit, b'captured-compile-stdout', b'', None
            return 0, b'', b'', None
        original_status = b.resource_status
        def status(*args, **kwargs):
            if final_floor and (output / 'report.json').exists():
                return 'disk-floor'
            return original_status(*args, **kwargs)
        with patch.object(b, 'checked_inputs', return_value=manifest), patch.object(b, 'allocation', return_value=grant), \
             patch.object(b.os, 'statvfs', return_value=self.free), patch.object(b, 'bounded_command', side_effect=fake_command), \
             patch.object(b, 'resource_status', side_effect=status):
            if sdk != 0x1a0500 or corrupt or compile_exit or final_floor:
                with self.assertRaises(ValueError):
                    b.execute(self.root / 'unused-grant', '0'*64)
                result = json.loads((output / 'failure.json').read_text())
            else:
                result = b.execute(self.root / 'unused-grant', '0'*64)
        return result, calls, output

    def test_actual_old_sdk_never_reaches_signing_and_preserves_partial_log(self):
        result, calls, output = self.orchestration(sdk=0x100400)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['commands'][0]['exitCode'], 0)
        self.assertEqual((output / 'compile-fresh-shell.stdout').read_bytes(), b'captured-compile-stdout')
        self.assertFalse(result['native240Accepted'])

    def test_info_or_original_framework_change_never_reaches_sign(self):
        result, calls, _ = self.orchestration(corrupt='Frameworks/J')
        self.assertEqual(len(calls), 1)
        self.assertEqual(result['status'], 'failed')

    def test_failed_compile_retains_primary_exit_and_never_signs(self):
        result, calls, _ = self.orchestration(compile_exit=17)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result['commands'][0]['exitCode'], 17)

    def test_success_orchestration_is_shell_only_no_device_acceptance(self):
        result, calls, _ = self.orchestration()
        self.assertEqual(len(calls), 4)
        self.assertEqual(result['actualLinkedBuildVersionBeforeSigning']['SDK'], '26.5.0')
        self.assertEqual(result['status'], 'fresh-shell-built-signed-verified-no-device')
        self.assertFalse(result['deviceExecuted'])
        self.assertFalse(result['native240Accepted'])
        self.assertFalse(result['databaseRead'])
        self.assertFalse(result['controlBuildPerformed'])

    def test_final_accounting_refusal_cannot_leave_positive_result(self):
        result, calls, output = self.orchestration(final_floor=True)
        self.assertEqual(len(calls), 4)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(json.loads((output / 'report.json').read_text())['status'], 'failed')
        self.assertFalse(result['allCompilerOrServiceProcessesStoppedVerified'])

    def test_monitor_exception_retains_actual_host_output_and_kills_only_own_child(self):
        def guard(pending=0, **kwargs):
            if pending:
                raise OSError('unexpected generated-tree observation error')
            return None
        args = [sys.executable, '-c', 'import time; print("owned-host-output",flush=True); time.sleep(10)']
        code, stdout, stderr, stopped = b.bounded_command(args, {'PATH': '/usr/bin:/bin'}, self.root, 2, guard)
        self.assertEqual(stdout, b'owned-host-output\n')
        self.assertEqual(stderr, b'')
        self.assertIsNotNone(code)
        self.assertEqual(stopped, 'monitor-error:OSError')


if __name__ == '__main__':
    unittest.main()
