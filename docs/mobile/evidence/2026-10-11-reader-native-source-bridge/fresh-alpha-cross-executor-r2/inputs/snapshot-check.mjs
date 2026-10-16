// Host-only delegation to the unchanged production fixture observation guard.
import {readFileSync, existsSync, lstatSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const expectedRoot='/private/tmp/slax-reader-fresh-alpha-cross-c26ced6d60c34bbcb9f2590c6dc453c4';
const [mode, root]=process.argv.slice(2);
if (!['alpha','cross'].includes(mode)||root!==expectedRoot||process.argv.length!==4) throw Error('Unallocated snapshot check');
const repo=resolve(import.meta.dirname,'../../../../../../');
const {bindGenuineAlphaContinuation,observeCrossParagraphRange}=await import(pathToFileURL(join(repo,'apps/mobile/fixtures/reader-native-ios/control/cross-paragraph/snapshot-guard.mjs')));
function json(relative) {
  const path=join(root,relative), stat=lstatSync(path);
  if (!stat.isFile()||stat.isSymbolicLink()||stat.size>262144) throw Error('Unbounded same-scope observation');
  return JSON.parse(readFileSync(path,'utf8'));
}
const report=json('alpha-report.json'),expected=json('alpha-expected.json');
const before=json(existsSync(join(root,'snapshots/cross-before/reader-selection.json'))?'snapshots/cross-before/reader-selection.json':'snapshots/alpha/reader-selection.json');
const ancestry=bindGenuineAlphaContinuation(report,before,expected);
if(mode==='alpha') console.log(JSON.stringify({ancestry,nativeFrameReviewStillRequired:true}));
else {
  const manifest=json('cross-attachments/manifest.json');
  if(manifest.length!==1||manifest[0].testIdentifier!=='ReaderCrossParagraphControl/testNativeEndHandleDragFromGenuineAlphaTowardSecondParagraph()') throw Error('Wrong native attachment selector');
  const records=manifest[0].attachments.filter(e=>e.deviceId==='B85A7582-A0A7-4A0F-9BF0-8424330859F3'&&e.suggestedHumanReadableName.startsWith('cross-paragraph-actual-native-input-geometry'));
  if(records.length!==1||!/^[-A-Fa-f0-9]+\.txt$/.test(records[0].exportedFileName)) throw Error('Missing unique actual native geometry');
  const geometry=json('cross-attachments/'+records[0].exportedFileName);
  console.log(JSON.stringify({ancestry,range:observeCrossParagraphRange(before,json('snapshots/cross-after/reader-selection.json'),geometry),nativeFrameReviewStillRequired:true}));
}
