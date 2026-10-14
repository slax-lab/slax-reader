"""Pure guards and one controlled host subprocess; no native/device invocation."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('run-fresh-alpha-cross.py')
spec=importlib.util.spec_from_file_location('fresh_alpha_cross',PATH)
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)


class Guards(unittest.TestCase):
    def test_root_and_every_directory_counted(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'a/b').mkdir(parents=True);(root/'a/b/data').write_bytes(b'x')
            expected=sum(p.lstat().st_blocks*512 for p in [root,root/'a',root/'a/b',root/'a/b/data'])
            self.assertEqual(probe.tree(root)['allocatedBytes'],expected)
            self.assertEqual(probe.tree(root)['logicalBytes'],1)

    def test_directory_symlink_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'target').mkdir();(root/'link').symlink_to(root/'target')
            with self.assertRaisesRegex(ValueError,'Symlink'):probe.tree(root)

    def test_fifo_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();os.mkfifo(root/'pipe')
            with self.assertRaisesRegex(ValueError,'nonregular'):probe.tree(root)

    def test_sparse_file_logical_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            with (root/'sparse').open('wb') as out:out.truncate(probe.CAP+1)
            with self.assertRaisesRegex(ValueError,'256MiB'):probe.resource_guard(probe.tree(root),{'logicalBytes':0,'allocatedBytes':0},probe.PRE,0)

    def test_allocated_cap_even_when_logical_small(self):
        with self.assertRaisesRegex(ValueError,'256MiB'):probe.resource_guard({'logicalBytes':1,'allocatedBytes':probe.CAP},{'logicalBytes':0,'allocatedBytes':0},probe.PRE,0)

    def test_existing_helper_bytes_count_toward_cap(self):
        with self.assertRaisesRegex(ValueError,'256MiB'):probe.resource_guard({'logicalBytes':probe.CAP-1,'allocatedBytes':0},{'logicalBytes':2,'allocatedBytes':0},probe.PRE,0)

    def test_all_log_bytes_share_one_cap(self):
        with self.assertRaisesRegex(ValueError,'8MiB'):probe.resource_guard({'logicalBytes':0,'allocatedBytes':0},{'logicalBytes':0,'allocatedBytes':0},probe.PRE,probe.LOG_CAP+1)

    def test_initial_floor_and_ongoing_floor(self):
        zero={'logicalBytes':0,'allocatedBytes':0}
        with self.assertRaisesRegex(ValueError,'floor'):probe.resource_guard(zero,zero,probe.PRE-1,0,True)
        probe.resource_guard(zero,zero,probe.FLOOR,0)
        with self.assertRaisesRegex(ValueError,'floor'):probe.resource_guard(zero,zero,probe.FLOOR-1,0)

    def test_handoff_keeps_native_and_release_budget(self):
        probe.remaining_for_cross(101)
        with self.assertRaisesRegex(ValueError,'45\+30\+4'):probe.remaining_for_cross(101.01)

    def test_no_other_selector_or_device_or_prepare_selection(self):
        probe.exact_command(probe.test_command('alpha'));probe.exact_command(probe.test_command('cross'))
        for argv in [[probe.XCRUN,'simctl','shutdown','another-device'],[probe.XCRUN,'simctl','launch',probe.DEVICE,'app.slax.reader'],
                     [probe.XCODE,'build'],[probe.NODE,str(probe.CONTROL),'--platform','ios','--device',probe.NAME,'--action','{"kind":"selection"}']]:
            with self.assertRaisesRegex(ValueError,'Unallocated'):probe.exact_command(argv)

    def test_wrong_or_mixed_selector_native_summary_refused(self):
        value={'testNodes':[{'nodeType':'Test Case','nodeIdentifier':'ReaderNativeControl/testNativeLongPressOriginalBodyWord()','result':'Passed'}]}
        probe.exact_test_nodes(value,'alpha')
        with self.assertRaisesRegex(ValueError,'selector'):probe.exact_test_nodes(value,'cross')
        value['testNodes'].append(value['testNodes'][0].copy())
        with self.assertRaisesRegex(ValueError,'selector'):probe.exact_test_nodes(value,'alpha')

    def test_scope_must_be_one_exact_owned_ui_child(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();root=data/'Library/Caches/slax-ui-fixtures/reader-mixed-123-aabb';root.mkdir(parents=True)
            self.assertEqual(probe.scope_path(root.as_uri()+'/',data),root)
            for value in [root.as_uri(),root.as_uri()+'/?x=1',root.as_uri().replace('reader-mixed','reader-other')+'/',root.as_uri().replace('Library','Other')+'/']:
                with self.assertRaises((ValueError,OSError)):probe.scope_path(value,data)

    def test_scope_symlink_cannot_leave_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True);(data/'outside').mkdir()
            (base/'reader-mixed-1-aa').symlink_to(data/'outside')
            with self.assertRaisesRegex(ValueError,'Unsafe'):probe.scope_path((base/'reader-mixed-1-aa').as_uri()+'/',data)

    def test_operator_filename_denied_before_read(self):
        for name in ['../outside','/tmp/any','.env','a/google-services.json','a/GoogleService-Info.plist','a/credentials.json']:
            with self.assertRaises(ValueError):probe.relative(name)

    def test_raw_byte_bind_does_not_trim(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();file=root/'raw.json';file.write_bytes(b'{"a":1}\n')
            self.assertEqual(probe.bound({'path':str(file),'bytes':8,'sha256':probe.sha(file)}),file)
            with self.assertRaisesRegex(ValueError,'Changed'):probe.bound({'path':str(file),'bytes':7,'sha256':probe.sha(file)})

    def test_actual_failed_host_process_records_exit_and_raw_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'logs').mkdir();(root/'tmp').mkdir()
            executor=object.__new__(probe.Executor);executor.commands=[];executor.samples=[];executor.process=None
            executor.receipt={'commands':executor.commands};executor.remaining=lambda:180;executor.resources=lambda **kw:None
            with patch.object(probe,'RUN',root),patch.object(probe,'exact_command',lambda argv:None):
                with self.assertRaisesRegex(ValueError,'nonzero'):
                    executor.command([sys.executable,'-c','import sys; print("owned-negative-host-only"); sys.exit(17)'],5)
                receipt=json.loads((root/'receipt.json').read_text());command=receipt['commands'][0]
                self.assertEqual(command['exitCode'],17);self.assertIsInstance(command['ownedPID'],int)
                self.assertIsNotNone(command['stopped']);self.assertEqual(command['stdoutSHA256'],probe.sha(root/'logs/00.stdout'))
                self.assertIn('owned-negative-host-only',(root/'logs/00.stdout').read_text())

    def test_pre_spawn_refusal_still_has_final_record(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'logs').mkdir();(root/'tmp').mkdir()
            executor=object.__new__(probe.Executor);executor.commands=[];executor.receipt={'commands':executor.commands};executor.remaining=lambda:180
            executor.resources=lambda **kw:(_ for _ in ()).throw(ValueError('controlled-floor-refusal'))
            with patch.object(probe,'RUN',root),patch.object(probe,'exact_command',lambda argv:None):
                with self.assertRaisesRegex(ValueError,'controlled-floor'):executor.command([sys.executable,'-c','raise Exception("must not run")'])
            command=json.loads((root/'receipt.json').read_text())['commands'][0]
            self.assertIsNone(command['ownedPID']);self.assertIsNone(command['exitCode']);self.assertIn('controlled-floor',command['stopped'])

    def barrier_fixture(self,root):
        (root/'snapshots/alpha').mkdir(parents=True);(root/'alpha-report.json').write_text('{"publisherBuild":false}\n')
        (root/'snapshots/alpha/reader-selection.json').write_text('{"captured":{"paths":1,"textLength":5}}\n')
        live={'scopeUri':'fresh-exact-scope','cacheKey':'fresh-cache','pageId':'fresh-page','nativeTag':71,'ownerPID':123,
              'windowStartedUnixSeconds':1,'alphaAllocationSHA256':'a'*64,'alphaNonce':'first-nonce'}
        value={**{k:live[k] for k in ('scopeUri','cacheKey','pageId','nativeTag','ownerPID','windowStartedUnixSeconds','alphaAllocationSHA256')},
               'nonce':'second-nonce','alphaReportSHA256':probe.sha(root/'alpha-report.json'),
               'alphaSnapshotSHA256':probe.sha(root/'snapshots/alpha/reader-selection.json'),'rawAlphaSummarySHA256':'b'*64,'rawAlphaXCResultManifestSHA256':'c'*64}
        independent={'kind':'root-independent-fresh-alpha-and-live-continuation-review','version':1,'accepted':True,'device':probe.DEVICE,
                     **{k:value[k] for k in ('scopeUri','cacheKey','pageId','nativeTag','alphaReportSHA256','alphaSnapshotSHA256','rawAlphaSummarySHA256','rawAlphaXCResultManifestSHA256')},
                     'actualNativeBlueHandlesAndMenuReviewed':True,'actualNative240Reviewed':True,'noPreparedDOMRange':True,
                     'noSyntheticSelectionEvent':True,'singleNativeAlphaPressReviewed':True,'onlyCurrent377Scope':True}
        return live,value,independent,{'scopeUri':live['scopeUri'],'publisherBuild':False}

    def test_cross_requires_fresh_raw_alpha_and_independent_review(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();live,value,independent,report=self.barrier_fixture(root)
            with patch.object(probe,'RUN',root):
                probe.cross_barrier(value,live,report,'b'*64,'c'*64,independent)
                for key in ['accepted','actualNativeBlueHandlesAndMenuReviewed','actualNative240Reviewed','singleNativeAlphaPressReviewed','onlyCurrent377Scope']:
                    with self.subTest(key=key),self.assertRaisesRegex(ValueError,'independent'):
                        probe.cross_barrier(value,live,report,'b'*64,'c'*64,{**independent,key:False})

    def test_cross_refuses_scope_page_native_tag_and_owner_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();live,value,independent,report=self.barrier_fixture(root)
            with patch.object(probe,'RUN',root):
                for key in ['scopeUri','cacheKey','pageId','nativeTag','ownerPID','windowStartedUnixSeconds','alphaAllocationSHA256']:
                    with self.subTest(key=key),self.assertRaises(ValueError):
                        probe.cross_barrier({**value,key:'different'},live,report,'b'*64,'c'*64,independent)
                with self.assertRaisesRegex(ValueError,'reused'):probe.cross_barrier({**value,'nonce':live['alphaNonce']},live,report,'b'*64,'c'*64,independent)

    def test_cross_rejects_changed_snapshot_raw_results_and_old_report(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();live,value,independent,report=self.barrier_fixture(root)
            with patch.object(probe,'RUN',root):
                for key in ['alphaReportSHA256','alphaSnapshotSHA256','rawAlphaSummarySHA256','rawAlphaXCResultManifestSHA256']:
                    with self.subTest(key=key),self.assertRaisesRegex(ValueError,'fresh raw Alpha'):
                        probe.cross_barrier({**value,key:'d'*64},live,report,'b'*64,'c'*64,independent)

    def test_final_accounting_error_preserves_primary_and_final_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();executor=object.__new__(probe.Executor);executor.products={};executor.receipt={};executor.policy={'installedUI':{'files':[],'appRoot':str(root)}}
            executor.alpha=lambda:(_ for _ in ()).throw(ValueError('initial-owned-failure'));executor.cross=lambda:self.fail('Cross must not run')
            executor.release=lambda:None;executor.remaining=lambda:170
            executor.resources=lambda **kw:(_ for _ in ()).throw(ValueError('final-accounting-refusal'))
            with patch.object(probe,'RUN',root),patch.object(probe,'verify_stage',lambda:None),patch.object(probe,'verify_app',lambda *args:None):
                self.assertEqual(executor.run(),1)
            receipt=json.loads((root/'receipt.json').read_text())
            self.assertIn('initial-owned-failure',receipt['refusal']);self.assertEqual(receipt['finalGuardFailure'],'final-accounting-refusal');self.assertTrue(receipt['finished'])


if __name__=='__main__':unittest.main(verbosity=2)
