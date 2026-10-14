#!/usr/bin/env python3
"""Host-only checks of the actual bounded build executor; no native subprocesses."""
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location('source_scroll_build', ROOT / 'apps/mobile/fixtures/source-ios/control/build-native-scroll.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='host-guard-', dir=HERE)
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.manifest = json.loads((HERE / 'inputs.json').read_bytes())
        self.output = Path('/private/tmp') / ('slax-source-native-scroll-build-' + str(uuid.uuid4()))
        now = int(time.time() * 1000)
        self.grant = {'kind':'slax-root-source-native-scroll-build-allocation','version':3,'outputRoot':str(self.output),
            'inputsSHA256':executor.INPUTS_SHA256,'executorSHA256':executor.digest(Path(executor.__file__).resolve()),
            'sourceBaseMarkerSHA256':self.manifest['baseMarkerSHA256'],'rawFrameworkMachOSHA256':self.manifest['rawFrameworkMachOSHA256'],
            'fixtureInputSHA256':self.manifest['fixtureInputSHA256'],'exclusiveNativeSlot':True,'allowSwiftAndXCTestBuildOnly':True,
            'allowKmpOrGradle':False,'allowDeviceCommands':False,'allowMetroCommands':False,'allowGlobalCleanup':False,
            'nonce':str(uuid.uuid4()),'requestedAt':now-100,'expiresAt':now+5000}
        self.allocation = self.root/'allocation.json'
        class Stats:
            f_bavail = self.manifest['budget']['minimumFreeBeforeBytes']
            f_frsize = 1
        self.disk = Stats()
    def check(self):
        self.allocation.write_text(json.dumps(self.grant)+'\n')
        with patch.object(executor.os, 'statvfs', return_value=self.disk), patch.object(executor.subprocess, 'Popen', side_effect=AssertionError('No subprocess permitted')):
            return executor.owned_allocation(self.allocation, self.output, self.manifest)
    def test_current_exact_allocation_is_read_only(self):
        self.assertEqual(self.check(), self.grant)
        self.assertFalse(self.output.exists())
    def test_old_allocation_and_changed_tool_or_fixture_are_rejected(self):
        for key,value in [('kind','slax-root-ui-ts-refresh-allocation'),('executorSHA256','0'*64),('fixtureInputSHA256','5b8'*21),('allowDeviceCommands',True),('exclusiveNativeSlot',1)]:
            with self.subTest(key=key):
                old=self.grant[key]; self.grant[key]=value
                with self.assertRaises(ValueError): self.check()
                self.grant[key]=old
    def test_expired_or_long_allocation_rejected(self):
        for expires in [self.grant['requestedAt'],self.grant['requestedAt']+600001]:
            self.grant['expiresAt']=expires
            with self.assertRaises(ValueError):self.check()
    def test_pre_floor_is_not_lowered_to_runtime_floor(self):
        self.disk.f_bavail=self.manifest['budget']['minimumFreeBeforeBytes']-1
        with self.assertRaisesRegex(ValueError,'reserve'):self.check()
    def test_only_exact_fresh_namespace_allowed(self):
        self.output=self.root/'reused-output'
        self.output.mkdir();self.grant['outputRoot']=str(self.output)
        with self.assertRaises(ValueError):self.check()
    def test_tampered_real_manifest_fails_before_subprocess(self):
        (self.root/'inputs.json').write_bytes((HERE/'inputs.json').read_bytes()+b' ')
        with patch.object(executor,'HERE',self.root),patch.object(executor.subprocess,'Popen',side_effect=AssertionError('No subprocess permitted')):
            with self.assertRaisesRegex(ValueError,'manifest changed'):executor.checked_inputs()
    def test_sparse_exception_does_not_bypass_allocated_or_product_caps(self):
        budget=dict(self.manifest['budget']);budget['minimumFreeDuringBytes']=0
        sparse=self.root/'derived-data/SDKStatCaches.noindex/public.sdkstatcache';sparse.parent.mkdir(parents=True)
        with sparse.open('wb') as f:f.seek(budget['maximumNewProductLogicalBytes']+1);f.write(b'X')
        self.assertIsNone(executor.resource_status(self.root,budget))
        budget['maximumNewAllocatedBytes']=1
        self.assertEqual(executor.resource_status(self.root,budget),'new-artifact-cap')
        sparse.unlink();app=self.root/'SlaxSourceFixtureApp.app/large';app.parent.mkdir()
        app.write_bytes(b'XYZ');budget['maximumNewAllocatedBytes']=402653184;budget['maximumNewProductLogicalBytes']=2
        self.assertEqual(executor.resource_status(self.root,budget),'unexpected-large-owned-file')
    def test_generated_external_symlink_rejected(self):
        link=self.root/'external';link.symlink_to('/usr/bin')
        budget=dict(self.manifest['budget']);budget['minimumFreeDuringBytes']=0
        self.assertEqual(executor.resource_status(self.root,budget),'external-generated-symlink')

if __name__ == '__main__':unittest.main(verbosity=2)
