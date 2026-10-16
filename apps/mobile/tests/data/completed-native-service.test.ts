import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {validateCompletedServicePrerequisite} from './completed-native-service.ts';
const report = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/android-original-queue-real-service.json', import.meta.url), 'utf8')).nativeServiceReport;

test('actual original service proof authorizes only the same controlled Android repeat run', () => {
  for (const phase of ['hold-after-offline-commit', 'resume-after-offline-commit', 'repeat-accepted']) validateCompletedServicePrerequisite(report, 'android', phase, report.runId);
  for (const [platform, phase, runId] of [['ios', 'repeat-accepted', report.runId], ['android', 'hold-before-sdk-open', report.runId], ['android', 'repeat-accepted', 'another-run']]) assert.throws(() => validateCompletedServicePrerequisite(report, platform!, phase!, runId));
});
test('pending queue, omitted native completion, reordered SQL receipt or changed native materialization cannot substitute for genuine completion', () => {
  const values = [
    {...report, pendingOperations: 2},
    {...report, realNativeSdkCompletions: report.realNativeSdkCompletions.slice(1)},
    {...report, exactServerSqlReceipts: [[...report.exactServerSqlReceipts[0]].reverse()]},
    {...report, materializedNativeRows: {...report.materializedNativeRows, sr_user_bookmark: [{...report.materializedNativeRows.sr_user_bookmark[0], is_starred: 0}]}},
    {...report, originalLegacyFirstQueueUpload: false},
    {...report, productionAdoptionEnabled: true},
  ];
  for (const value of values) assert.throws(() => validateCompletedServicePrerequisite(value, 'android', 'hold-after-offline-commit', report.runId));
});
