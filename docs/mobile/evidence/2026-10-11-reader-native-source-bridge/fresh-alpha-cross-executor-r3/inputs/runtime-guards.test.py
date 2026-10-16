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
    def actual_metro_raw(self):
        root=PATH.parents[2]/'fresh-alpha-cross-executor-r2/actual-metro-relative-command-refusal-root-review-r1'
        return (root/'raw/logs/01.stdout').read_bytes(),(root/'subsequent-owned-metro-cwd.stdout').read_bytes()

    def test_actual_root_relative_cli_and_three_cwd_fields_are_accepted(self):
        argv,cwd=self.actual_metro_raw();actual=probe.metro_ownership(argv,cwd)
        self.assertEqual(actual['ownedPID'],93891);self.assertEqual(actual['cwd'],str(probe.STAGE))
        self.assertEqual(actual['psRawSHA256'],'b6d1968e032cda2426b5c461e59263a8d461cc25231bea57f2518f204a10c0a8')
        self.assertEqual(actual['lsofRawSHA256'],'e56900e883325135ff0bc1ce647d160091061fec28620c1bad686e29c1fc4a83')
        self.assertNotIn(str(probe.STAGE).encode(),argv)

    def test_relative_cli_requires_exact_live_owned_cwd(self):
        argv,cwd=self.actual_metro_raw()
        for wrong in [cwd.replace(str(probe.STAGE).encode(),b'/private/tmp/foreign-stage'),
                      cwd.replace(b'p93891',b'p93892'),cwd.replace(b'fcwd\n',b'fother\n')]:
            with self.subTest(wrong=wrong),self.assertRaisesRegex(ValueError,'PID/cwd'):probe.metro_ownership(argv,wrong)

    def test_cwd_missing_duplicate_extra_fields_and_raw_whitespace_are_refused(self):
        argv,cwd=self.actual_metro_raw()
        for wrong in [cwd.replace(b'fcwd\n',b''),cwd+b'n/private/tmp/other\n',b'p93891\n'+cwd,
                      cwd.replace(b'\n',b'\r\n'),cwd.rstrip(b'\n'),cwd+b' ',cwd.replace(b'n/private/',b'n/')]:
            with self.subTest(wrong=wrong),self.assertRaisesRegex(ValueError,'PID/cwd'):probe.metro_ownership(argv,wrong)

    def test_cli_options_headers_paths_and_whitespace_cannot_replace_exact_argv(self):
        argv,cwd=self.actual_metro_raw()
        for wrong in [argv+b'--clear\n',argv.replace(b'--port 8083',b'--port 8084'),b'COMMAND\n'+argv,
                      argv.replace(b'node_modules/expo/bin/cli',str(probe.STAGE/'node_modules/expo/bin/cli').encode()),
                      argv.replace(b'\n',b'\r\n'),argv.rstrip(b'\n'),b' '+argv]:
            with self.subTest(wrong=wrong),self.assertRaisesRegex(ValueError,'exact CLI'):probe.metro_ownership(wrong,cwd)

    def test_lsof_command_is_closed_to_exact_owned_pid_and_cwd_only(self):
        argv=[probe.LSOF,'-a','-p','93891','-d','cwd','-Fn'];probe.exact_command(argv)
        for wrong in [[probe.LSOF],argv[:-1],argv+['-t'],[probe.LSOF,'-a','-p','93892','-d','cwd','-Fn'],
                      [probe.LSOF,'-a','-p','93891','-Fn']]:
            with self.subTest(wrong=wrong),self.assertRaisesRegex(ValueError,'Unallocated'):probe.exact_command(wrong)

    def test_prior_run_commands_and_allocation_paths_are_refused_before_read(self):
        old='c26ced6d60c34bbcb9f2590c6dc453c4';self.assertNotIn(old,str(probe.RUN));self.assertNotIn(old,str(probe.GRANTS))
        argv=probe.test_command('alpha');old_argv=[arg.replace('70641adca8a446cbbeb6177a7e5dfe2c',old) for arg in argv]
        with self.assertRaisesRegex(ValueError,'Unallocated'):probe.exact_command(old_argv)
        prior=Path('/private/tmp/slax-reader-fresh-alpha-cross-grants-'+old)/'alpha-allocation.json'
        with patch.object(probe,'sha',side_effect=AssertionError('must not read')) as read:
            with self.assertRaisesRegex(ValueError,'exact fresh Root grant'):probe.grant(prior,'a'*64,'alpha',{})
            read.assert_not_called()

    def fresh_scope(self, base, scenario='reader-mixed', suffix='123-aabb', marker=None):
        scope=base/(scenario+'-'+suffix);scope.mkdir(parents=True)
        value={'controlledFixture':True,'fixtureVersion':1,'scenario':scenario,'inputSha256':probe.INPUT_SHA}
        (scope/'slax-fixture.json').write_text(json.dumps(value if marker is None else marker))
        return scope

    def test_baseline_never_descends_into_historical_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';old=base/'historical-unchanged';old.mkdir(parents=True)
            (old/'must-never-follow').symlink_to('/not-a-task-owned-path')
            with patch.object(probe,'UI_DATA',data):
                baseline=probe.scope_metadata_baseline(data)
                self.assertEqual(set(baseline['children']),{'historical-unchanged'})
                actual=probe.fresh_scope_accounting(data,baseline,{})
            self.assertEqual(actual['scopes'],[]);self.assertEqual(actual['allocatedBytes'],0)

    def test_exact_fresh_reader_and_bootstrap_count_all_new_blocks_without_database_read(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            bootstrap=self.fresh_scope(base,'library-populated');reader=self.fresh_scope(base)
            (reader/'database').mkdir();(reader/'database/data.db').write_bytes(b'public-host-placeholder')
            original_read=Path.read_bytes;reads=[]
            def read(path):reads.append(path);return original_read(path)
            with patch.object(probe,'UI_DATA',data),patch.object(Path,'read_bytes',read):
                actual=probe.fresh_scope_accounting(data,baseline,{},reader.as_uri()+'/')
            self.assertEqual(set(reads),{reader/'slax-fixture.json',bootstrap/'slax-fixture.json'})
            expected=sum(p.lstat().st_blocks*512 for root in [reader,bootstrap] for p in [root,*root.rglob('*')])
            self.assertEqual(actual['allocatedBytes'],expected)
            self.assertEqual(len(actual['scopes']),2)

    def test_new_parent_allocation_is_counted_when_it_did_not_exist(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve()
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            base=data/'Library/Caches/slax-ui-fixtures';reader=self.fresh_scope(base)
            with patch.object(probe,'UI_DATA',data):actual=probe.fresh_scope_accounting(data,baseline,{})
            self.assertEqual(actual['newParentAllocatedBytes'],base.lstat().st_blocks*512)
            self.assertEqual(actual['allocatedBytes'],base.lstat().st_blocks*512+probe.tree(reader)['allocatedBytes'])

    def test_new_scope_bytes_cannot_hide_outside_run_and_helper_cap(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            reader=self.fresh_scope(base)
            with (reader/'native-cache.db').open('wb') as out:out.truncate(probe.CAP)
            with patch.object(probe,'UI_DATA',data):scopes=probe.fresh_scope_accounting(data,baseline,{})
            zero={'logicalBytes':0,'allocatedBytes':0}
            with self.assertRaisesRegex(ValueError,'256MiB'):probe.resource_guard(zero,zero,probe.PRE,0,scopes=scopes)
            with self.assertRaisesRegex(ValueError,'256MiB'):probe.resource_guard(zero,zero,probe.PRE,0,scopes={'logicalBytes':0,'allocatedBytes':probe.CAP})

    def test_unknown_new_name_refused_before_any_marker_read(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            (base/'settings-123-aa').mkdir()
            with patch.object(probe,'UI_DATA',data),patch.object(Path,'read_bytes',side_effect=AssertionError('must not read')) as read:
                with self.assertRaisesRegex(ValueError,'Unknown new scope name'):probe.fresh_scope_accounting(data,baseline,{})
                read.assert_not_called()

    def test_new_marker_closed_case_version_digest_and_boolean(self):
        for field,value in [('controlledFixture',False),('controlledFixture',1),('fixtureVersion',True),('fixtureVersion',2),('scenario','library-populated'),('inputSha256','b'*64),('extra',True)]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
                with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
                marker={'controlledFixture':True,'fixtureVersion':1,'scenario':'reader-mixed','inputSha256':probe.INPUT_SHA,field:value}
                self.fresh_scope(base,marker=marker)
                with patch.object(probe,'UI_DATA',data),patch.object(probe,'tree',side_effect=AssertionError('tree must not be read')) as walk:
                    with self.assertRaisesRegex(ValueError,'marker refused'):probe.fresh_scope_accounting(data,baseline,{})
                    walk.assert_not_called()

    def test_two_new_names_bound_survives_bootstrap_disposal(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            boot=self.fresh_scope(base,'library-populated');seen={}
            with patch.object(probe,'UI_DATA',data):probe.fresh_scope_accounting(data,baseline,seen)
            (boot/'slax-fixture.json').unlink();boot.rmdir();reader=self.fresh_scope(base)
            with patch.object(probe,'UI_DATA',data):probe.fresh_scope_accounting(data,baseline,seen,reader.as_uri()+'/')
            self.fresh_scope(base,'library-populated','124-aabb')
            with patch.object(probe,'UI_DATA',data),patch.object(Path,'read_bytes',side_effect=AssertionError('must not read')) as read:
                with self.assertRaisesRegex(ValueError,'one reader and one bootstrap'):probe.fresh_scope_accounting(data,baseline,seen)
                read.assert_not_called()

    def test_new_reader_must_equal_exact_controller_scope_and_be_fresh(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';old=self.fresh_scope(base,suffix='100-aa')
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            reader=self.fresh_scope(base)
            with patch.object(probe,'UI_DATA',data):
                with self.assertRaisesRegex(ValueError,'exact controller scope'):probe.fresh_scope_accounting(data,baseline,{},old.as_uri()+'/')
                actual=probe.fresh_scope_accounting(data,baseline,{},reader.as_uri()+'/')
                self.assertEqual(len(actual['scopes']),1)

    def test_new_scope_and_nested_links_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp).resolve();base=data/'Library/Caches/slax-ui-fixtures';base.mkdir(parents=True)
            with patch.object(probe,'UI_DATA',data):baseline=probe.scope_metadata_baseline(data)
            link=base/'reader-mixed-1-aa';link.symlink_to('/not-an-owned-scope')
            with patch.object(probe,'UI_DATA',data):
                with self.assertRaisesRegex(ValueError,'symlink'):probe.fresh_scope_accounting(data,baseline,{})
            link.unlink();reader=self.fresh_scope(base);(reader/'nested').symlink_to('/not-owned')
            with patch.object(probe,'UI_DATA',data):
                with self.assertRaisesRegex(ValueError,'Symlink'):probe.fresh_scope_accounting(data,baseline,{})

    def test_failed_cross_host_command_marks_issued_before_post_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'logs').mkdir();(root/'tmp').mkdir()
            executor=object.__new__(probe.Executor);executor.commands=[];executor.process=None
            executor.receipt={'commands':executor.commands,'crossNativeCommandIssued':False,'crossActualInputStatus':'not-issued','crossPostInputScopeAccepted':False}
            executor.remaining=lambda:180;executor.resources=lambda **kw:None
            argv=[sys.executable,'-c','import sys; print("host-only-cross-intent"); sys.exit(17)']
            with patch.object(probe,'RUN',root),patch.object(probe,'exact_command',lambda argv:None),patch.object(probe,'test_command',return_value=argv):
                with self.assertRaisesRegex(ValueError,'nonzero'):executor.command(argv,5)
            receipt=json.loads((root/'receipt.json').read_text())
            self.assertTrue(receipt['crossNativeCommandIssued']);self.assertIsInstance(receipt['crossNativeCommandPID'],int)
            self.assertEqual(receipt['crossActualInputStatus'],'unknown-after-native-command');self.assertFalse(receipt['crossPostInputScopeAccepted'])
            self.assertEqual(receipt['commands'][0]['exitCode'],17)

    def test_cross_pre_spawn_failure_never_claims_command_issued(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'logs').mkdir();(root/'tmp').mkdir()
            executor=object.__new__(probe.Executor);executor.commands=[];executor.process=None
            executor.receipt={'commands':executor.commands,'crossNativeCommandIssued':False,'crossActualInputStatus':'not-issued'}
            executor.remaining=lambda:180;executor.resources=lambda **kw:None
            with patch.object(probe,'RUN',root),patch.object(probe,'exact_command',lambda argv:None),patch.object(probe.subprocess,'Popen',side_effect=OSError('host-only-spawn-refusal')):
                with self.assertRaisesRegex(OSError,'spawn-refusal'):executor.command(probe.test_command('cross'),5)
            receipt=json.loads((root/'receipt.json').read_text())
            self.assertFalse(receipt['crossNativeCommandIssued']);self.assertEqual(receipt['crossActualInputStatus'],'not-issued')

    def test_completed_cross_selector_remains_observed_if_later_attachment_step_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();result=root/'cross.xcresult';result.mkdir();(result/'Info.plist').write_bytes(plistlib.dumps({'hostOnly':True}))
            summary={'result':'Passed','totalTestCount':1,'passedTests':1,'failedTests':0,'skippedTests':0,'expectedFailures':0,'testFailures':[],
                     'devicesAndConfigurations':[{'device':{'deviceId':probe.DEVICE,'architecture':'arm64','osVersion':'26.5'}}],
                     'title':'Test - CrossParagraphControl','startTime':1,'finishTime':2}
            tests={'testNodes':[{'nodeType':'Test Case','nodeIdentifier':'ReaderCrossParagraphControl/testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph()','result':'Passed'}]}
            (root/'summary.json').write_text(json.dumps(summary));(root/'tests.json').write_text(json.dumps(tests))
            executor=object.__new__(probe.Executor);executor.receipt={'crossNativeCommandIssued':True,'crossActualInputStatus':'unknown-after-native-command','crossPostInputScopeAccepted':False};executor.remaining=lambda:180
            def command(argv,seconds=5):
                if argv[0]==probe.XCODE:return root/'host-only-command.json'
                if 'summary' in argv:return root/'summary.json'
                if 'tests' in argv:return root/'tests.json'
                raise ValueError('host-only-attachment-postfailure')
            executor.command=command
            with patch.object(probe,'RUN',root):
                with self.assertRaisesRegex(ValueError,'postfailure'):executor.native_result('cross')
            receipt=json.loads((root/'receipt.json').read_text())
            self.assertEqual(receipt['crossActualInputStatus'],'observed-through-completed-native-selector');self.assertFalse(receipt['crossPostInputScopeAccepted'])
            self.assertEqual(receipt['crossCompletedSelectorEvidence']['summarySHA256'],probe.sha(root/'summary.json'))

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
