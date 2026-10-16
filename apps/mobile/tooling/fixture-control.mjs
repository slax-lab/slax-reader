import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {selectFixtureInspector} from './fixture-control-contract.mjs';
// Reuse the transport already shipped with React Native; no application plugin is added.
const require = createRequire(import.meta.url);
const WebSocket = require(require.resolve('ws', {paths: [require.resolve('react-native/package.json')]}));

// Only the independent local UI fixture runtime is addressed. These commands prepare
// state; they never certify a native gesture, visible frame, or source parity.
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--platform', '--device', '--case', '--locale', '--action', '--font-scale', '--observe'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error('Unexpected fixture control argument');
  options[args[i]] = args[i + 1];
}
const platform = options['--platform'], device = options['--device'], locale = options['--locale'] ?? 'en';
if (!['ios', 'android'].includes(platform) || !device || !['en', 'zh'].includes(locale)) throw new Error('Select an explicit isolated platform, device name and supported locale');
if ([options['--case'], options['--action'], options['--observe']].filter(Boolean).length !== 1 || (options['--observe'] && options['--observe'] !== 'current')) throw new Error('Select exactly one prepared case, action or current observation');
const bundle = JSON.parse(await readFile(new URL('../fixtures/scenarios.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const digest = manifest.files.find(file => file.path === 'scenarios.json')?.sha256;
if (!digest || bundle.schemaVersion !== 1) throw new Error('Unknown shared fixture input');
const expectedFontScale = options['--font-scale'] === undefined ? null : Number(options['--font-scale']);
if (expectedFontScale !== null && (!Number.isFinite(expectedFontScale) || expectedFontScale < 1 || expectedFontScale > 3)) throw new Error('Unsupported fixture font scale');
const scenario = options['--case'];
if (scenario && !Object.hasOwn(bundle.scenarios, scenario)) throw new Error('Unknown prepared fixture case');
const action = options['--action'] ? JSON.parse(options['--action']) : null;
if (action && (!action || typeof action !== 'object' || Array.isArray(action) || !/^[a-z-]+$/.test(action.kind))) throw new Error('Invalid prepared action');
const targets = await (await fetch('http://127.0.0.1:8083/json/list', {signal: AbortSignal.timeout(5_000)})).json();
const {appId, endpoint} = selectFixtureInspector(targets, platform, device);
const socket = new WebSocket(endpoint, {origin: 'http://127.0.0.1:8083'});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Fixture inspector connection timed out')), 5_000);
  socket.addEventListener('open', () => {clearTimeout(timer); resolve();}, {once: true});
  socket.addEventListener('error', () => {clearTimeout(timer); reject(new Error('Fixture inspector connection failed'));}, {once: true});
});
const expression = `async function(){
  let current;for(let i=0;i<200;i++){current=globalThis.__SLAX_UI_FIXTURE__;if(current)break;await new Promise(resolve=>setTimeout(resolve,50));}
  if(!current||current.inputSha256!==${JSON.stringify(digest)}||!current.scopeUri.includes('/slax-ui-fixtures/'))throw Error('Unprepared or mismatched independent fixture runtime');
  ${scenario ? `const previousScope=current.scopeUri;current.selectCase(${JSON.stringify(scenario)},${JSON.stringify(locale)});
  for(let i=0;i<200;i++){const next=globalThis.__SLAX_UI_FIXTURE__;if(next&&next.scopeUri!==previousScope&&next.scenario===${JSON.stringify(scenario)}&&next.locale===${JSON.stringify(locale)}&&next.inputSha256===${JSON.stringify(digest)}){try{const renderContext=await next.captureContext();if(renderContext.scenario===next.scenario&&renderContext.inputSha256===next.inputSha256&&renderContext.locale===next.locale&&renderContext.nativeMeasurements&&(${JSON.stringify(scenario && !bundle.scenarios[scenario].payload.upgrade ? bundle.scenarios[scenario].route.name : null)}===null||renderContext.observedRoute?.name===${JSON.stringify(scenario && !bundle.scenarios[scenario].payload.upgrade ? bundle.scenarios[scenario].route.name : null)})&&(${JSON.stringify(expectedFontScale)}===null||Math.abs(renderContext.nativeMeasurements.fontScale-${JSON.stringify(expectedFontScale)})<0.000001))return {scenario:next.scenario,inputSha256:next.inputSha256,scopeUri:next.scopeUri,locale:next.locale,renderContext,preparationOnly:true,nativeInteractionVerified:false};}catch{}}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Selected fixture preparation timed out');` : `return {${action ? `...await current.perform(${JSON.stringify(action)}),` : ''}scenario:current.scenario,inputSha256:current.inputSha256,scopeUri:current.scopeUri,renderContext:await current.captureContext(),preparationOnly:${Boolean(action)},nativeInteractionVerified:false};`}
}()`;
let requestId = 0;
async function evaluate(expression) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {socket.removeEventListener('message', receive); reject(new Error('Fixture preparation response timed out'));}, 20_000);
    function receive(event) {
      const response = JSON.parse(String(event.data));
      if (response.id !== id) return;
      clearTimeout(timer); socket.removeEventListener('message', receive);
      if (response.error || response.result?.exceptionDetails) reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
      else resolve(response.result?.result?.value);
    }
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, returnByValue: true}}));
  });
}
const nonce = randomUUID();
try {
  await evaluate(`globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__={nonce:${JSON.stringify(nonce)},status:'pending'};void (${expression}).then(value=>{globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__={nonce:${JSON.stringify(nonce)},status:'done',value};},error=>{globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__={nonce:${JSON.stringify(nonce)},status:'error',message:String(error)};});'started';`);
  let result;
  for (let i = 0; i < 200; i++) {
    const raw = await evaluate('JSON.stringify(globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__)');
    const response = typeof raw === 'string' ? JSON.parse(raw) : null;
    if (response?.nonce !== nonce) throw new Error('Fixture preparation response identity mismatch');
    if (response.status === 'error') throw new Error(response.message);
    if (response.status === 'done') {result = response.value; break;}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!result || result.inputSha256 !== digest || result.nativeInteractionVerified !== false) throw new Error('Invalid or timed-out fixture preparation response');
  console.log(JSON.stringify({appId, device, ...result}, null, 2));
  await evaluate(`if(globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__?.nonce===${JSON.stringify(nonce)})delete globalThis.__SLAX_UI_FIXTURE_CONTROL_RESPONSE__;`);
} finally {socket.close();}
