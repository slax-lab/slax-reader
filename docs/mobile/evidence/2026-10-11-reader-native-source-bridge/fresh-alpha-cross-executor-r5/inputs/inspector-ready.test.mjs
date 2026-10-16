// Actual production selector, injected host metadata transport; no live HTTP/Inspector.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {admitRoot, ROOT, DEVICE, INVENTORY, LIMITS, inspectInventory, readInventory, waitReady} from './inspector-ready.mjs';
const target={appId:'app.slax.reader.uifixture',deviceName:DEVICE,webSocketDebuggerUrl:'ws://127.0.0.1:8083/inspector/debug?device=test&page=1'};
const response=value=>({status:200,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(value)));c.close();}})});

test('cold no-match inventory then exact independent target becomes ready with fixed GET only',async()=>{
  let milliseconds=0;const seen=[];const records=[];
  const ready=await waitReady({now:()=>milliseconds,sleep:async ms=>{milliseconds+=ms;},record:r=>records.push(r),
    fetchImpl:async(url,options)=>{seen.push({url,options});return response(seen.length<3?[{...target,appId:'app.slax.reader'}]:[target]);}});
  assert.equal(ready.requestsIssued,3);assert.equal(ready.elapsedMilliseconds,500);
  assert.equal(ready.endpoint,target.webSocketDebuggerUrl);assert.equal(ready.appId,target.appId);
  assert.equal(ready.websocketOpened,false);assert.equal(ready.expressionEvaluated,false);assert.equal(ready.fixtureActionIssued,false);
  assert.deepEqual(records,[{attempt:1,matchingIndependentTarget:false},{attempt:2,matchingIndependentTarget:false},{attempt:3,matchingIndependentTarget:true}]);
  for(const {url,options} of seen){assert.equal(url,INVENTORY);assert.deepEqual(Object.keys(options).sort(),['cache','method','redirect','signal']);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.signal.aborted,true);}
});
test('unchanged production selector refuses duplicate matches and unsafe endpoints without retry',async()=>{
  for(const value of [[target,target], [{...target,webSocketDebuggerUrl:'ws://127.0.0.1:8084/inspector/debug'}],
      [{...target,webSocketDebuggerUrl:'wss://127.0.0.1:8083/inspector/debug'}],
      [{...target,webSocketDebuggerUrl:'ws://localhost:8083/inspector/debug'}]]){
    let calls=0;await assert.rejects(waitReady({fetchImpl:async()=>{calls++;return response(value);}}),/Exactly one|Unexpected local/);assert.equal(calls,1);
  }
});
test('wrong app or device stays pending and cannot widen selector or outlive20 seconds',async()=>{
  let milliseconds=0,calls=0;
  await assert.rejects(waitReady({now:()=>milliseconds,sleep:async ms=>{milliseconds+=ms;},fetchImpl:async()=>{
    calls++;return response([{...target,deviceName:'Foreign device'}, {...target,appId:'app.slax.reader'}]);}}),/readiness deadline/);
  assert.equal(milliseconds,20000);assert.equal(calls,80);assert.equal(LIMITS.requests,80);
});
test('body type/size/JSON/list and entry caps reject before any selector action',async()=>{
  for(const value of [null, {}, new Array(201).fill(target)])await assert.rejects(readInventory(async()=>response(value),2000),/metadata inventory/);
  let canceled=false;const bytes=new Uint8Array(65537);
  const raw={status:200,body:{getReader(){return {read:async()=>({done:false,value:bytes}),cancel:async()=>{canceled=true;},releaseLock(){}};}}};
  await assert.rejects(readInventory(async()=>raw,2000),/body cap/);assert.equal(canceled,true);
  await assert.rejects(readInventory(async()=>({status:302,body:response([]).body}),2000),/metadata response/);
  await assert.rejects(readInventory(async()=>({status:200,body:new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close();}})}),2000),/metadata JSON/);
});
test('held metadata request is canceled by fixed per-request timeout without WebSocket fallback',async()=>{
  let signal;
  await assert.rejects(readInventory(async(_url,options)=>{signal=options.signal;return new Promise(()=>{});},5),/metadata request timeout/);
  assert.equal(signal.aborted,true);
});
test('readiness helper admits only synchronized new root before transport',()=>{
  admitRoot([ROOT]);
  for(const old of ['1b39303dfecd4db394e2b95c27e9a962','70641adca8a446cbbeb6177a7e5dfe2c','c26ced6d60c34bbcb9f2590c6dc453c4'])
    assert.throws(()=>admitRoot(['/private/tmp/slax-reader-fresh-alpha-cross-'+old]),/Unallocated/);
  assert.throws(()=>admitRoot([ROOT,'--extra']),/Unallocated/);
});
test('actual r4 retained failure precedes native Alpha and reveals no Inspector inventory',()=>{
  const repo=resolve(import.meta.dirname,'../../../../../../');
  const report=JSON.parse(readFileSync(resolve(repo,'docs/mobile/evidence/2026-10-11-reader-native-source-bridge/fresh-alpha-cross-executor-r4/actual-inspector-unattached-root-review-r1/report.json')));
  assert.equal(report.kind,'root-actual-fresh-alpha-r4-fixture-inspector-unattached-negative');
  // Bind exact public negative bytes in the author report; these checks use metadata only.
  assert.equal(report.actualNativeAlphaCommands,0);assert.equal(report.actualNativeCrossCommands,0);
  assert.equal(report.inspectorMatchCountUnknown,true);assert.equal(report.actualNoDevClientConnectionCauseProved,false);
  assert.equal(inspectInventory([]),null);
});
