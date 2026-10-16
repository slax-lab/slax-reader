// Prepared-only readiness: metadata GET, no WebSocket, expression or fixture action.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(import.meta.dirname,'../../../../../../');
const {selectFixtureInspector}=await import(pathToFileURL(resolve(repo,'apps/mobile/tooling/fixture-control-contract.mjs')));

export const ROOT='/private/tmp/slax-reader-fresh-alpha-cross-38ce646b95414adf8aabe2776c313ca4';
export const DEVICE='SlaxColdShareControlled-20261011-Mg6KLJ';
export const INVENTORY='http://127.0.0.1:8083/json/list';
export const LIMITS=Object.freeze({milliseconds:20000,requestMilliseconds:2000,intervalMilliseconds:250,bodyBytes:65536,entries:200,requests:80});
function require(value,message){if(!value)throw Error(message);}
export function admitRoot(args){require(args.length===1&&args[0]===ROOT,'Unallocated Inspector readiness root');}
export function inspectInventory(targets){
  require(Array.isArray(targets)&&targets.length<=LIMITS.entries,'Invalid/bounded Inspector metadata inventory required');
  const matches=targets.filter(t=>t?.appId==='app.slax.reader.uifixture'&&t.deviceName===DEVICE);
  if(matches.length===0)return null;
  // A duplicate or unsafe matching endpoint is a terminal refusal, never a retry.
  return selectFixtureInspector(targets,'ios',DEVICE);
}
export async function readInventory(fetchImpl,timeout){
  const controller=new AbortController();let reader;
  let rejectTimeout;
  const timed=new Promise((_,reject)=>{rejectTimeout=reject;});
  const timer=setTimeout(()=>{controller.abort();rejectTimeout(Error('Inspector metadata request timeout'));},timeout);
  try{
    return await Promise.race([timed,(async()=>{
      const response=await fetchImpl(INVENTORY,{method:'GET',redirect:'error',cache:'no-store',signal:controller.signal});
      require(response.status===200&&response.body&&typeof response.body.getReader==='function','Invalid Inspector metadata response');
      reader=response.body.getReader();let total=0;const chunks=[];
      for(;;){const value=await reader.read();if(value.done)break;
        require(value.value instanceof Uint8Array,'Invalid Inspector metadata body');total+=value.value.byteLength;
        require(total<=LIMITS.bodyBytes,'Inspector metadata body cap');chunks.push(value.value);
      }
      const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let targets;try{targets=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('Invalid Inspector metadata JSON');}
      return inspectInventory(targets);
    })()]);
  }finally{
    clearTimeout(timer);controller.abort();
    // Cancellation cannot extend the whole-process deadline if a custom reader stalls.
    if(reader){Promise.resolve(reader.cancel()).catch(()=>{});try{reader.releaseLock();}catch{}}
  }
}
export async function waitReady({fetchImpl=globalThis.fetch,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),record=()=>{}}={}){
  const started=now();let requests=0;
  while(now()-started<LIMITS.milliseconds&&requests<LIMITS.requests){
    requests++;
    const timeout=Math.min(LIMITS.requestMilliseconds,LIMITS.milliseconds-(now()-started));
    const selected=await readInventory(fetchImpl,timeout);
    record({attempt:requests,matchingIndependentTarget:selected!==null});
    if(selected)return {kind:'bounded-read-only-fixture-inspector-ready',appId:selected.appId,deviceName:DEVICE,
      endpoint:selected.endpoint,requestsIssued:requests,elapsedMilliseconds:now()-started,
      websocketOpened:false,expressionEvaluated:false,fixtureActionIssued:false};
    const remaining=LIMITS.milliseconds-(now()-started);
    if(remaining>0)await sleep(Math.min(LIMITS.intervalMilliseconds,remaining));
  }
  throw Error('Independent fixture Inspector readiness deadline exhausted');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  admitRoot(process.argv.slice(2));
  const ready=await waitReady({record:value=>process.stderr.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify(ready)+'\n');
}
